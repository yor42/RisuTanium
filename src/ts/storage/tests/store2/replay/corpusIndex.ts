/**
 * Where each 409/404 category of the model and each of its surprises went. The model's
 * first path per category (its step labels, in the model's own call order) is the source;
 * a schedule re-derives the race to the library's call order (plan amendment A) and asserts
 * the reaction the library has, which is the model's reaction where the library has the
 * same branch and the library's own where it does not.
 *
 * Every entry is one of:
 *  - `schedule`: the corpus file runs on the unmodified library (and under its mutants, in the scratch runner);
 *  - `pending`: the corpus file is written against the actor interface and is skipped until the rig has what it needs;
 *  - `none`: the library has no counterpart that the replay can reach, with the reason; no schedule exists.
 * `replay.test.ts` fails when a category, a surprise or a corpus file of part (ii) is missing here.
 */
export type IndexKind = 'schedule' | 'pending' | 'none'

export interface IndexEntry {
    /** The model's category (`c409`, numbered as its exporter numbers them) or surprise. */
    id: string
    /** What the model's path shows: its category and its reaction. */
    model: string
    kind: IndexKind
    /** The corpus file's name, without the extension; null for `none`. */
    schedule: string | null
    /** For a schedule: the reaction the library has, as the schedule asserts it. Otherwise: why there is none, or what is missing. */
    note: string
}

export const CORPUS_INDEX: readonly IndexEntry[] = [
    {
        id: 'c409-01', model: 'start-up clear CAS, commit key moved => re-read, retry', kind: 'none', schedule: null,
        note: 'The library clears a marker at boot only for a seed or convert marker of the device\'s own owner id (Tauri), through the committer\'s abandon-clear, whose re-judge loop is the one the bulk final write and c409-07 exercise. A peer write between that boot read and that clear cannot be scheduled: the page gate admits one live page, the actors of a page share the session that exists only after the boot (the clear included) has finished, and a newer page makes the older one stale instead of conflicting. The clear itself runs in surprise-s1.',
    },
    {
        id: 'c409-02', model: 'base manifest read 404 => re-read commit key', kind: 'schedule', schedule: 'c409_02_base_manifest_404',
        note: 'Boot reads the commit key and then the manifest it names, and does not read the key again: a missing manifest is the recovery screen, row 6 with the tree missing (a commit key that is stale by more than the retained list). The page is not asked to build on it. The recovery screen of that boot runs on the commit key the boot read: its marker write conflicts at that token because the key has moved on, and the exit is abandoned.',
    },
    {
        id: 'c409-03', model: 'commit CAS, commit key moved => park or reload, never rebuild on the peer index', kind: 'schedule', schedule: 'c409_03_commit_ck_moved',
        note: 'The commit reports conflict and writes nothing more; the committer never writes again at the version the conflict reported.',
    },
    {
        id: 'c409-04', model: 'commit CAS, new unit mismatch => re-upload under a new key, retry', kind: 'schedule', schedule: 'c409_04_commit_unit_mismatch',
        note: 'The commit fails (the unit conflict is a definite failure); the caller\'s retry builds the whole tree again, and the mint issues only keys no earlier attempt offered.',
    },
    {
        id: 'c409-05', model: 'pin CAS, commit key moved => park or reload', kind: 'schedule', schedule: 'c409_05_pin_ck_moved',
        note: 'The pin reports conflict and writes nothing.',
    },
    {
        id: 'c409-06', model: 'uncertain commit CAS, not mine => park or reload', kind: 'schedule', schedule: 'c409_06_uncertain_not_mine',
        note: 'The lost reply is settled by reading the key back; a stored value that is not the commit\'s own is a conflict, never a success.',
    },
    {
        id: 'c409-07', model: 'abandon-clear CAS, commit key moved => leave the marker, park', kind: 'schedule', schedule: 'c409_07_abandon_clear_moved',
        note: 'The final write is judged again on a fresh read three times, then the own-marker clear is judged three times; when every attempt conflicts the marker is left standing and the bulk is reported abandoned (rejudge-exhausted).',
    },
    {
        id: 'c409-08', model: 'foreign clear CAS => the prompt closes', kind: 'schedule', schedule: 'c409_08_foreign_clear',
        note: 'The second clear conflicts, re-reads and finds no marker: the clear reports nothing written and the question ends.',
    },
    {
        id: 'c409-09', model: 'bulk begin CAS, commit key moved => park or reload', kind: 'schedule', schedule: 'c409_09_bulk_begin_moved',
        note: 'The bulk commit reports conflict before any marker or unit exists.',
    },
    {
        id: 'c409-10', model: 'bulk final CAS, commit key moved => park or reload', kind: 'schedule', schedule: 'c409_10_bulk_final_moved',
        note: 'The re-read shows the marker gone (a confirmed foreign clear): the bulk is abandoned with marker-lost and writes nothing. Where the marker stands the library lands instead of parking (surprise-s2).',
    },
    {
        id: 'c409-11', model: 'GC refuses => unparsable commit key', kind: 'schedule', schedule: 'c409_11_gc_refuses_unparsable',
        note: 'The pass refuses at the mark (mark-refused) before any list or batch. Damage after the pass\'s read is the amendment-J case, judged by the commit-key damage schedules.',
    },
    {
        id: 'c409-12', model: 'GC refuses => unconfirmed commit-key flush', kind: 'schedule', schedule: 'c409_12_gc_refuses_unflushed',
        note: 'The commit\'s commit-key write reports flushed:false (the scheduler\'s flush fault), the page\'s flush tracker sets the idle reason and the pass refuses (refused:idle) with nothing deleted. A restart that drops the unflushed write puts back the first commit\'s commit key (current is the first commit\'s manifest and the seeded tree is retained, not the seeded key itself) and the tree it names is still stored; without the refusal the pass would have orphaned that tree (I1 at the restart).',
    },
    {
        id: 'c409-13', model: 'GC manifest read 404 => abort the pass, re-list', kind: 'schedule', schedule: 'c409_13_gc_manifest_read_404',
        note: 'The model never reached it. An environment step (remove-unit) takes the retained manifest out between the pass\'s commit-key read and its manifest reads; the mark finds it missing and refuses the pass (mark-refused) before any list or batch, so nothing is re-listed or deleted. The checker excuses only that step\'s keys from the I1 walk and keeps the lost manifest\'s tree protected while the commit key names it, so a pass that deletes inside it is I1.',
    },
    {
        id: 'c409-14', model: 'GC remove, commit key moved => re-read and retry', kind: 'schedule', schedule: 'c409_14_gc_remove_moved',
        note: 'The batch conflicts on the commit key and deletes nothing; the pass starts again from a fresh read and deletes only what the new commit key does not name.',
    },
    {
        id: 'c409-15', model: 'restore CAS, commit key moved => re-read, choose again', kind: 'schedule', schedule: 'c409_15_restore_ck_moved',
        note: 'The restore reports conflict and writes nothing; the caller reads and chooses again.',
    },
    {
        id: 'c409-16', model: 'recovery marker CAS, chosen unit gone => fails loudly', kind: 'schedule', schedule: 'c409_16_rec_marker_unit_gone',
        note: 'The marker lands (the library writes it before it reads the tree) and the tree read then fails with the missing units: the pick is invalid, marked, and nothing is installed.',
    },
    {
        id: 'c409-17', model: 'recovery marker CAS, commit key changed => re-read, abandon if it parses', kind: 'schedule', schedule: 'c409_17_rec_marker_ck_changed',
        note: 'The marker write conflicts; the re-read parses with a current and the exit is abandoned.',
    },
    {
        id: 'c409-18', model: 'recovery final CAS, commit key moved => give up or abandon-clear', kind: 'schedule', schedule: 'c409_18_rec_final_moved',
        note: 'The final write conflicts at the marker\'s read-back token; the re-read does not name the install, so the install is abandoned and the staged copy is left for collection.',
    },
    {
        id: 'surprise-s1', model: 'the owner\'s start-up clear of its own marker after a restart', kind: 'schedule', schedule: 'surprise_s1_owner_startup_clear',
        note: 'On a device owner (Tauri) a new page finds its own seed marker and clears it at boot, with no question.',
    },
    {
        id: 'surprise-s2', model: 'a bulk page parks after a 409 with its own marker standing', kind: 'schedule', schedule: 'surprise_s2_bulk_park_marker_standing',
        note: 'The library does not park: a conflict on the final write is judged again on a fresh read, and while its own marker stands the write is repeated and lands, clearing the marker.',
    },
    {
        id: 'surprise-s3', model: 'a new 404 path: a peer rotates the manifest out and GC deletes it between the two reads', kind: 'schedule', schedule: 'surprise_s3_base_manifest_404_crash_rotate_gc',
        note: 'Crash, a new page, twenty-one rotating commits, a pass; the manifest read finds the unit gone and boot decides the recovery screen; the screen\'s marker write, made at the boot\'s commit key read, conflicts and the exit is abandoned.',
    },
    {
        id: 'surprise-s3c', model: 'the same 404 after a crash, damage and a recovery marker', kind: 'schedule', schedule: 'surprise_s3c_base_manifest_404_after_crash',
        note: 'The distinct path is the recovery route: a recovery installs a staged copy, its fence is discarded and a pass deletes the old trees; boot decides the recovery screen, whose marker write at the boot\'s commit key read conflicts and abandons the exit. The model\'s damage and crash are not part of the path in the library.',
    },
    {
        id: 'surprise-s6', model: 'check-only unit mismatch with the commit key matching: the manifest is uploaded again', kind: 'schedule', schedule: 'surprise_s6_unit_mismatch_manifest_reupload',
        note: 'Part of the units is retired; the commit fails and the retry builds every unit again, the manifest under a fresh key.',
    },
    {
        id: 'inst-lost-reply-peer-bulk-begin', model: 'driver check, not a model category: the install post-condition (INST) after a lost reply and a peer bulk-begin', kind: 'schedule', schedule: 'instLostReplyPeerBulkBegin',
        note: 'Regression reproducer for the INST false positive. The final write applies and its reply is lost, a peer\'s bulk-begin rewrites the key keeping the same current, and the install is reported as installed with the peer\'s bytes; INST holds the actor\'s own write naming the manifest, so nothing is reported and the peer\'s bulk commits.',
    },
    {
        id: 'inst-lost-reply-peer-bulk-begin-tauri', model: 'driver check, not a model category: the install post-condition (INST) after a lost reply and a peer bulk-begin, on the Tauri backend', kind: 'schedule', schedule: 'tauriInstLostReplyPeerBulkBegin',
        note: 'Regression reproducer, the Tauri copy of inst-lost-reply-peer-bulk-begin. The compare-and-write reads the commit key under the mutex before its write, so the read-back is the install\'s second read of the key and the hold names it with nth.',
    },
    {
        id: 'inst-lost-request-control', model: 'driver check, not a model category: the install post-condition (INST) after a lost request', kind: 'schedule', schedule: 'instLostRequestControl',
        note: 'Compatibility guard, green before and after the INST rule change. The final write is lost before it applies, the read-back shows the marker, the retry lands and the install is reported as installed with its own applied write behind it.',
    },
    {
        id: 'tauri-install-unit-unflushed', model: 'driver check, not a model category: a staged unit of a recovery install whose flush failed, then a restart', kind: 'schedule', schedule: 'tauriInstallUnitUnflushedThenRestart',
        note: 'Regression reproducer. A staged unit write reports flushed:false; the install stops with upload-failed before its final write, so no commit key names the unit. The restart that drops the unit finds the recovery marker still standing and the checker, which excuses no dropped unit, reports nothing. Before the fix the install named the unit and the restart left a commit key naming a missing unit (I1).',
    },
]
