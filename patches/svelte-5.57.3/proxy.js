// Derived from svelte@5.57.3 src/internal/client/proxy.js. Copyright (c) 2016-2025 Svelte Contributors, MIT License.
// Modified by RisuTanium: state proxies keep parent links and report writes (see "RISU PATCH" below).
/** @import { Source } from '#client' */
import { DEV } from 'esm-env';
import {
	get,
	active_effect,
	update_version,
	active_reaction,
	set_update_version,
	set_active_reaction
} from './runtime.js';
import {
	array_prototype,
	get_descriptor,
	get_prototype_of,
	is_array,
	object_prototype
} from '../shared/utils.js';
import {
	state as source,
	set,
	increment,
	flush_eager_effects,
	set_eager_effects_deferred
} from './reactivity/sources.js';
import { COMPONENT_SYMBOL, PROXY_PATH_SYMBOL, STATE_SYMBOL } from '#client/constants';
import { UNINITIALIZED } from '../../constants.js';
import * as e from './errors.js';
import { tag } from './dev/tracing.js';
import { get_error } from '../shared/dev.js';
import { tracing_mode_flag } from '../flags/index.js';

// TODO move all regexes into shared module?
const regex_is_valid_identifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;

// RISU PATCH: parent links for state proxies and one write callback (RisuTanium DIRTY-RC). The patch records
// structure and reports writes; what a write marks is decided by the application (src/ts/storage/dbWriteHook.ts).
/** @type {null | ((error: unknown) => void)} */
var state_write_error_sink = null;
/** @type {null | ((kind: 0 | 1 | 2, owner: any, prop: PropertyKey, value: any, stored: any) => void)} */
var state_write_hook = null;
/** @type {null | ((child: any, child_record: any, parent_record: any) => void)} */
var state_link_hook = null;
/**
 * Registers the write callback, the error sink for both callbacks, and the link callback.
 * @param {null | ((kind: 0 | 1 | 2, owner: any, prop: PropertyKey, value: any, stored: any) => void)} fn
 * @param {null | ((error: unknown) => void)} on_error
 * @param {null | ((child: any, child_record: any, parent_record: any) => void)} on_link
 */
export function set_state_write_hook(fn, on_error = null, on_link = null) {
	state_write_hook = fn;
	state_write_error_sink = on_error;
	state_link_hook = on_link;
}
// The suffix counts committed revisions of this patch.
export const PATCH_ID = 'risu-proxy-patch svelte@5.57.3 r1';
/** @param {any} child @param {any} Rc @param {any} Rp */
function call_link_hook(child, Rc, Rp) {
	try {
		state_link_hook(child, Rc, Rp);
	} catch (error) {
		try {
			if (state_write_error_sink !== null) state_write_error_sink(error);
		} catch {}
	}
}
/**
 * proxy -> record { r: parent record, k: key or null for an array parent, more: other links or null,
 * tag: opaque to the patch, owned by the write hook }. Links are never removed and hold their parent
 * records, never a proxy or a sources map.
 */
export const state_records = new WeakMap();
// The symbol's description carries the patch id and the symbol is read by every proxy's get trap, so the id string
// stays in any build that contains this runtime, whether or not the application installs the hook.
export const STATE_REF = Symbol(PATCH_ID);
/** @param {any} p */
export function record_of(p) {
	var R = state_records.get(p);
	if (R === undefined) {
		R = { r: null, k: null, more: null, tag: undefined };
		state_records.set(p, R);
	}
	return R;
}
/**
 * Axiom S: two proxies share a record only when both are arrays and a fresh array replaces an array under an
 * object key. Every plain-object record belongs to exactly one proxy, so the hook's single-valued fact (the
 * character tag) sits only on records that are never shared.
 * @param {any} fresh
 * @param {any} old
 */
function adopt_record(fresh, old) {
	if (!(is_array(fresh) && is_array(old))) return;
	state_records.set(fresh, record_of(old));
}
/**
 * Records that `child` (a state proxy) was stored under `key` of `parent` (a state proxy or a record).
 * A link that already exists is a no-op and calls nothing. That dedupe is single-valued on a possibly shared
 * (array) parent record: its only effect is to skip the link callback for the first placement through a
 * second sharer, and the hook's list rule and tag pass compensate for it.
 * @param {any} child
 * @param {any} parent
 * @param {PropertyKey | null} key
 */
export function link_state_child(child, parent, key) {
	if (typeof child !== 'object' || child === null || !(STATE_SYMBOL in child)) return;
	var Rp = STATE_SYMBOL in parent ? record_of(parent) : parent;
	var Rc = record_of(child);
	if (Rc.r === null) {
		Rc.r = Rp;
		Rc.k = key;
	} else {
		if (Rc.r === Rp && Rc.k === key) return;
		var more = Rc.more;
		if (more === null) {
			Rc.more = [{ r: Rp, k: key }];
		} else {
			for (var i = 0; i < more.length; i++) if (more[i].r === Rp && more[i].k === key) return;
			more.push({ r: Rp, k: key });
		}
	}
	// A new link to an array parent: the write hook may tag the child record (the app keeps a character id).
	if (key === null && state_link_hook !== null) call_link_hook(child, Rc, Rp);
}
/**
 * @param {0 | 1 | 2} kind
 * @param {any} owner
 * @param {PropertyKey} prop
 * @param {any} value
 * @param {any} stored
 */
function call_write_hook(kind, owner, prop, value, stored) {
	if (state_write_hook === null) return;
	try {
		state_write_hook(kind, owner, prop, value, stored);
	} catch (error) {
		// the write already happened; a failing hook must never fail it
		try {
			if (state_write_error_sink !== null) state_write_error_sink(error);
		} catch {}
	}
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function proxy(value) {
	// if non-proxyable, a component instance, or already a proxy, return `value`
	if (
		typeof value !== 'object' ||
		value === null ||
		STATE_SYMBOL in value ||
		COMPONENT_SYMBOL in value
	) {
		return value;
	}

	const prototype = get_prototype_of(value);

	if (prototype !== object_prototype && prototype !== array_prototype) {
		return value;
	}

	/** @type {Map<any, Source<any>>} */
	var sources = new Map();
	var is_proxied_array = is_array(value);
	var version = source(0);

	var stack = DEV && tracing_mode_flag ? get_error('created at') : null;
	var parent_version = update_version;

	/**
	 * Executes the proxy in the context of the reaction it was originally created in, if any
	 * @template T
	 * @param {() => T} fn
	 */
	var with_parent = (fn) => {
		if (update_version === parent_version) {
			return fn();
		}

		// child source is being created after the initial proxy —
		// prevent it from being associated with the current reaction
		var reaction = active_reaction;
		var version = update_version;

		set_active_reaction(null);
		set_update_version(parent_version);

		var result = fn();

		set_active_reaction(reaction);
		set_update_version(version);

		return result;
	};

	if (is_proxied_array) {
		// We need to create the length source eagerly to ensure that
		// mutations to the array are properly synced with our proxy
		sources.set('length', source(/** @type {any[]} */ (value).length, stack));
		if (DEV) {
			value = /** @type {any} */ (inspectable_array(/** @type {any[]} */ (value)));
		}
	}

	/** Used in dev for $inspect.trace() */
	var path = '';
	let updating = false;
	/** @param {string} new_path */
	function update_path(new_path) {
		if (updating) return;
		updating = true;
		path = new_path;

		tag(version, `${path} version`);

		// rename all child sources and child proxies
		for (const [prop, source] of sources) {
			tag(source, get_label(path, prop));
		}
		updating = false;
	}

	/** @type {any} */
	var self;
	/** @param {PropertyKey} prop */
	var link_key = (prop) => (is_proxied_array ? null : prop);

	return (self = new Proxy(/** @type {any} */ (value), {
		defineProperty(_, prop, descriptor) {
			if (
				!('value' in descriptor) ||
				descriptor.configurable === false ||
				descriptor.enumerable === false ||
				descriptor.writable === false
			) {
				// we disallow non-basic descriptors, because unless they are applied to the
				// target object — which we avoid, so that state can be forked — we will run
				// afoul of the various invariants
				// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/getOwnPropertyDescriptor#invariants
				e.state_descriptors_fixed();
			}
			var s = sources.get(prop);
			if (s === undefined) {
				with_parent(() => {
					var s = source(descriptor.value, stack);
					sources.set(prop, s);
					if (DEV && typeof prop === 'string') {
						tag(s, get_label(path, prop));
					}
					return s;
				});
			} else {
				set(s, descriptor.value, true);
			}

			call_write_hook(2, self, prop, descriptor.value, descriptor.value);
			if (typeof descriptor.value === 'object' && descriptor.value !== null) link_state_child(descriptor.value, self, link_key(prop));
			return true;
		},

		deleteProperty(target, prop) {
			var s = sources.get(prop);
			var existed = s === undefined ? prop in target : s.v !== UNINITIALIZED;

			if (s === undefined) {
				if (prop in target) {
					const s = with_parent(() => source(UNINITIALIZED, stack));
					sources.set(prop, s);
					increment(version);

					if (DEV) {
						tag(s, get_label(path, prop));
					}
				}
			} else {
				set(s, UNINITIALIZED);
				increment(version);
			}

			if (existed) call_write_hook(1, self, prop, undefined, undefined);
			return true;
		},

		get(target, prop, receiver) {
			if (prop === STATE_SYMBOL) {
				return value;
			}
			if (prop === STATE_REF) {
				return self;
			}

			if (DEV && prop === PROXY_PATH_SYMBOL) {
				return update_path;
			}

			var s = sources.get(prop);
			var exists = prop in target;

			// create a source, but only if it's an own property and not a prototype property
			if (s === undefined && (!exists || get_descriptor(target, prop)?.writable)) {
				s = with_parent(() => {
					var p = proxy(exists ? target[prop] : UNINITIALIZED);
					var s = source(p, stack);
					if (typeof p === 'object' && p !== null) link_state_child(p, self, link_key(prop));

					if (DEV) {
						tag(s, get_label(path, prop));
					}

					return s;
				});

				sources.set(prop, s);
			}

			if (s !== undefined) {
				var v = get(s);
				return v === UNINITIALIZED ? undefined : v;
			}

			return Reflect.get(target, prop, receiver);
		},

		getOwnPropertyDescriptor(target, prop) {
			this.has?.(target, prop);

			var descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
			var s = sources.get(prop);

			if (s !== undefined) {
				var value = get(s);

				if (value === UNINITIALIZED) {
					return undefined;
				}

				if (descriptor && 'value' in descriptor) {
					descriptor.value = value;
				} else {
					return {
						enumerable: true,
						configurable: true,
						value,
						writable: true
					};
				}
			}

			return descriptor;
		},

		has(target, prop) {
			if (prop === STATE_SYMBOL) {
				return true;
			}

			var s = sources.get(prop);
			var has = (s !== undefined && s.v !== UNINITIALIZED) || Reflect.has(target, prop);

			if (
				s !== undefined ||
				((active_effect !== null || active_reaction !== null) &&
					(!has || get_descriptor(target, prop)?.writable))
			) {
				if (s === undefined) {
					s = with_parent(() => {
						var p = has ? proxy(target[prop]) : UNINITIALIZED;
						var s = source(p, stack);
						if (typeof p === 'object' && p !== null) link_state_child(p, self, link_key(prop));

						if (DEV) {
							tag(s, get_label(path, prop));
						}

						return s;
					});

					sources.set(prop, s);
				}

				var value = get(s);
				if (value === UNINITIALIZED) {
					return false;
				}
			}

			return has;
		},

		set(target, prop, value, receiver) {
			var s = sources.get(prop);
			var has = prop in target;
			var changed = false;
			/** @type {any} */
			var stored = undefined;

			// variable.length = value -> clear all signals with index >= value
			if (is_proxied_array && prop === 'length') {
				for (var i = value; i < /** @type {Source<number>} */ (s).v; i += 1) {
					var other_s = sources.get(i + '');
					if (other_s !== undefined) {
						set(other_s, UNINITIALIZED);
					} else if (i in target) {
						// If the item exists in the original, we need to create an uninitialized source,
						// else a later read of the property would result in a source being created with
						// the value of the original item at that index.
						other_s = with_parent(() => source(UNINITIALIZED, stack));
						sources.set(i + '', other_s);

						if (DEV) {
							tag(other_s, get_label(path, i));
						}
					}
				}
			}

			// If we haven't yet created a source for this property, we need to ensure
			// we do so otherwise if we read it later, then the write won't be tracked and
			// the heuristics of effects will be different vs if we had read the proxied
			// object property before writing to that property.
			if (s === undefined) {
				if (!has || get_descriptor(target, prop)?.writable) {
					changed = !has || !Object.is(target[prop], value);
					s = with_parent(() => source(undefined, stack));

					if (DEV) {
						tag(s, get_label(path, prop));
					}
					stored = proxy(value);
					set(s, stored);

					sources.set(prop, s);
				}
			} else {
				has = s.v !== UNINITIALIZED;

				var p = with_parent(() => proxy(value));
				if (!is_proxied_array && p !== value && typeof p === 'object' && p !== null && typeof s.v === 'object' && s.v !== null && STATE_SYMBOL in s.v) adopt_record(p, s.v);
				changed = !Object.is(s.v, p);
				stored = p;
				set(s, p);
			}

			var descriptor = Reflect.getOwnPropertyDescriptor(target, prop);

			// Set the new value before updating any signals so that any listeners get the new value
			if (descriptor?.set) {
				descriptor.set.call(receiver, value);
			}

			if (!has) {
				// If we have mutated an array directly, we might need to
				// signal that length has also changed. Do it before updating metadata
				// to ensure that iterating over the array as a result of a metadata update
				// will not cause the length to be out of sync.
				if (is_proxied_array && typeof prop === 'string') {
					var ls = /** @type {Source<number>} */ (sources.get('length'));
					var n = Number(prop);

					if (Number.isInteger(n) && n >= ls.v) {
						set(ls, n + 1);
					}
				}

				increment(version);
			}

			// The hook sees the links as they were before this write (a list slot can tell a new
			// element from a moved one); the new link is added after it.
			if (changed) call_write_hook(0, self, prop, value, stored);
			if (typeof stored === 'object' && stored !== null) link_state_child(stored, self, link_key(prop));

			return true;
		},

		ownKeys(target) {
			get(version);

			var own_keys = Reflect.ownKeys(target).filter((key) => {
				var source = sources.get(key);
				return source === undefined || source.v !== UNINITIALIZED;
			});

			for (var [key, source] of sources) {
				if (source.v !== UNINITIALIZED && !(key in target)) {
					own_keys.push(key);
				}
			}

			return own_keys;
		},

		setPrototypeOf() {
			e.state_prototype_fixed();
		}
	}));
}

/**
 * @param {string} path
 * @param {string | symbol} prop
 */
function get_label(path, prop) {
	if (typeof prop === 'symbol') return `${path}[Symbol(${prop.description ?? ''})]`;
	if (regex_is_valid_identifier.test(prop)) return `${path}.${prop}`;
	return /^\d+$/.test(prop) ? `${path}[${prop}]` : `${path}['${prop}']`;
}

/**
 * @param {any} value
 */
export function get_proxied_value(value) {
	try {
		if (value !== null && typeof value === 'object' && STATE_SYMBOL in value) {
			return value[STATE_SYMBOL];
		}
	} catch {
		// the above if check can throw an error if the value in question
		// is the contentWindow of an iframe on another domain, in which
		// case we want to just return the value (because it's definitely
		// not a proxied value) so we don't break any JavaScript interacting
		// with that iframe (such as various payment companies client side
		// JavaScript libraries interacting with their iframes on the same
		// domain)
	}

	return value;
}

/**
 * @param {any} a
 * @param {any} b
 */
export function is(a, b) {
	return Object.is(get_proxied_value(a), get_proxied_value(b));
}

const ARRAY_MUTATING_METHODS = new Set([
	'copyWithin',
	'fill',
	'pop',
	'push',
	'reverse',
	'shift',
	'sort',
	'splice',
	'unshift'
]);

/**
 * Wrap array mutating methods so $inspect is triggered only once and
 * to prevent logging an array in intermediate state (e.g. with an empty slot)
 * @param {any[]} array
 */
function inspectable_array(array) {
	return new Proxy(array, {
		get(target, prop, receiver) {
			var value = Reflect.get(target, prop, receiver);
			if (!ARRAY_MUTATING_METHODS.has(/** @type {string} */ (prop))) {
				return value;
			}

			/**
			 * @this {any[]}
			 * @param {any[]} args
			 */
			return function (...args) {
				set_eager_effects_deferred();
				var result = value.apply(this, args);
				flush_eager_effects();
				return result;
			};
		}
	});
}
