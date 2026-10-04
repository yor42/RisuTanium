export type LongpressCallback = (e: MouseEvent | TouchEvent) => void

export interface LongpressOptions {
	callback: LongpressCallback
	// Touch long-press fires the callback only on nodes that opt in; a plain callback is mouse-only.
	touch?: boolean
}

export function longpress(node:HTMLElement, param:LongpressCallback | LongpressOptions) {
	const TIME_MS = 500;
	const TOUCH_MOVE_PX = 10;
	// A browser may send mouse events after a touch; they must not start a second long-press.
	const COMPAT_MOUSE_MS = 1000;
	// A click that follows a fired touch long-press is swallowed for at most this long.
	const SUPPRESS_CLICK_MS = 500;
	const callback = typeof param === 'function' ? param : param.callback;
	const touchEnabled = typeof param === 'function' ? false : param.touch === true;
	let timeoutPtr: number;

	function handleMouseDown(e:MouseEvent) {
		if(touchEnabled && (touching || Date.now() - lastTouchEnd < COMPAT_MOUSE_MS)){
			return;
		}
		window.addEventListener('mousemove', handleMoveBeforeLong);
		timeoutPtr = window.setTimeout(() => {
			window.removeEventListener('mousemove', handleMoveBeforeLong);
			callback(e);
		}, TIME_MS);
	}
	function handleMoveBeforeLong(e:MouseEvent) {
		window.clearTimeout(timeoutPtr);
		window.removeEventListener('mousemove', handleMoveBeforeLong);
	}
	function handleMouseUp(e:MouseEvent) {
		window.clearTimeout(timeoutPtr);
		window.removeEventListener('mousemove', handleMoveBeforeLong);
	}

	let touching = false;
	let touchTimer: number | undefined;
	let touchFired = false;
	let lastTouchEnd = -Infinity;
	let startX = 0;
	let startY = 0;
	let suppressClick = false;
	let suppressTimer: number | undefined;

	function disarmSuppressor() {
		suppressClick = false;
		window.clearTimeout(suppressTimer);
	}
	function handleTouchStart(e:TouchEvent) {
		disarmSuppressor();
		window.clearTimeout(touchTimer);
		touchFired = false;
		if(e.touches.length !== 1){
			touching = e.touches.length > 0;
			return;
		}
		touching = true;
		startX = e.touches[0].clientX;
		startY = e.touches[0].clientY;
		touchTimer = window.setTimeout(() => {
			touchFired = true;
			callback(e);
		}, TIME_MS);
	}
	function handleTouchMove(e:TouchEvent) {
		const t = e.touches[0];
		if(t && Math.hypot(t.clientX - startX, t.clientY - startY) >= TOUCH_MOVE_PX){
			window.clearTimeout(touchTimer);
		}
	}
	function handleTouchEnd(e:TouchEvent) {
		window.clearTimeout(touchTimer);
		touching = e.touches.length > 0;
		lastTouchEnd = Date.now();
		if(touchFired){
			touchFired = false;
			if(e.type === 'touchend' && e.cancelable){
				e.preventDefault();
			}
			suppressClick = true;
			window.clearTimeout(suppressTimer);
			suppressTimer = window.setTimeout(disarmSuppressor, SUPPRESS_CLICK_MS);
		}
	}
	function handleClickCapture(e:MouseEvent) {
		if(suppressClick){
			disarmSuppressor();
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}
	// The native callout menu would cover the dialog the long-press opens.
	function handleContextMenu(e:Event) {
		if(touching){
			e.preventDefault();
		}
	}

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mouseup', handleMouseUp);
	if(touchEnabled){
		node.addEventListener('touchstart', handleTouchStart, {passive: true});
		node.addEventListener('touchmove', handleTouchMove, {passive: true});
		node.addEventListener('touchend', handleTouchEnd);
		node.addEventListener('touchcancel', handleTouchEnd);
		node.addEventListener('click', handleClickCapture, true);
		node.addEventListener('contextmenu', handleContextMenu);
	}
	return {
		destroy: () => {
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mouseup', handleMouseUp);
			window.clearTimeout(timeoutPtr);
			window.removeEventListener('mousemove', handleMoveBeforeLong);
			if(touchEnabled){
				node.removeEventListener('touchstart', handleTouchStart);
				node.removeEventListener('touchmove', handleTouchMove);
				node.removeEventListener('touchend', handleTouchEnd);
				node.removeEventListener('touchcancel', handleTouchEnd);
				node.removeEventListener('click', handleClickCapture, true);
				node.removeEventListener('contextmenu', handleContextMenu);
				window.clearTimeout(touchTimer);
				disarmSuppressor();
			}
		}
	};
}
