// Named configurations. Everything not listed takes DEFAULT from model.mjs (= the S0-5a model with every E1 feature off).
export const PRESETS = {
  // ---------------- the five original S0-5a controls (S0-5a bounds, features off) ----------------
  full: {},
  fullForeign: { foreignClear: true },
  c1_noGcCheck: { gcCheck: false },
  c2_noUnitCheck: { unitCheck: false },
  c3_sepRetention: { sepRetention: true },
  c4_bulkNoMarker: { noMarker: true },
  c5_freshRead: { freshRead: true },
  offNode: { offNode: true, gcCheck: false, unitCheck: false, noMarker: true },
  offNodeNoMutex: { offNode: false, gcCheck: false, unitCheck: false, noMarker: true },
  tiny: { ordA: 1, ordB: 1, crashes: 0 },
};

// ---------------- E1-1 bounds (plan "Bounds"): A 1 ordinary + 1 bulk; B 1 ordinary (+ 1 pin change); 1 GC pass; 1 restorer;
// retained 2; K 2; retry bound 2; at most 1 crash and 1 lost response per actor per run ----------------
const E1 = { ordA: 1, ordB: 1, bulkA: 1, RL: 2, K: 2, RB: 2, crashes: 1, lost: 1, orphanAbs: true, merge: true, admission: true, pinOps: 1, abandonClear: true };
// Node: guarded routes (check-only), commit-key damage that leaves the revision unchanged (so a pre-damage device can heal it), recovery actor
export const E1_NODE = { ...E1, damage: 1, damageMode: 'silent', recoveries: 1 };
// IndexedDB: one-transaction commit, in-transaction GC check, no mutex; damage changes the bytes; save-mine; recovery
export const E1_IDB = { ...E1, offNode: true, idb: true, gcCheck: true, unitCheck: false, noMarker: false, saveMine: 1, damage: 1, damageMode: 'bump', recoveries: 1 };
// Tauri: in-process mutex, durable-write faults (unit flush failure, commit-key flush failure, power loss); no bulk, no damage
export const E1_TAURI = { ...E1, bulkA: 0, offNode: true, tauri: true, gcCheck: false, unitCheck: false, noMarker: true, flushFail: 1, ckFlushFail: 1, powerLoss: 1 };

Object.assign(PRESETS, {
  e1_node: E1_NODE,
  e1_idb: E1_IDB,
  e1_tauri: E1_TAURI,
  // the original controls on the E1 Node bounds (features on)
  e1n_c1: { ...E1_NODE, gcCheck: false },
  e1n_c2: { ...E1_NODE, unitCheck: false },
  e1n_c3: { ...E1_NODE, sepRetention: true },
  e1n_c4: { ...E1_NODE, noMarker: true },
  e1n_c5: { ...E1_NODE, freshRead: true },
  // ---------------- E1-1 mutants ----------------
  m_aclearNoCheck: { ...E1_NODE, aclearNoCheck: true },
  m_aclearNoRead: { ...E1_NODE, aclearNoRead: true },
  m_restoreDropStg: { ...E1_NODE, restoreDropStg: true },
  m_restoreNoPush: { ...E1_NODE, restoreNoPush: true },
  m_smDropStg: { ...E1_IDB, smDropStg: true },
  m_smDropPins: { ...E1_IDB, smDropPins: true },
  m_markIgnoresPins: { ...E1_NODE, reload: true, redo: true, markIgnoresPins: true },
  m_gcNoPfxSkip: { ...E1_NODE, noPfxSkip: true },
  m_reuseUnits_tauri: { ...E1_TAURI, reload: true, redo: true, reuseUnits: true },
  m_reuseUnits_idb: { ...E1_IDB, reload: true, redo: true, reuseUnits: true },
  m_idbSplit: { ...E1_IDB, idbSplit: true },
  m_gcCheckOutside: { ...E1_IDB, gcCheckOutside: true },
  m_ckBeforeUnits: { ...E1_TAURI, ckBeforeUnits: true },
  m_nameUnflushed: { ...E1_TAURI, nameUnflushed: true },
  m_tauriGcIgnoresCkFlag: { ...E1_TAURI, reload: true, redo: true, tauriGcIgnoresCkFlag: true },
  m_recDirect: { ...E1_NODE, recDirect: true },
  m_recRetryBlind: { ...E1_NODE, recRetryBlind: true },
  m_seqOnly: { ...E1_IDB, reload: true, redo: true, seqTrack: true, seqOnly: true },
  m_gcOutsidePrefix: { ...E1_NODE, gcOutsidePrefix: true },
  m_replayV1: { ...E1_NODE, replayV1: true },
  // no-mutant sanity runs of the mutant configurations' shape
  s_seqTrack_idb: { ...E1_IDB, seqTrack: true },
});

// ---- follow-up (results-2): F1 fix candidates on the reduced actor set A, B (healer), GC, R; no restore/pin/admission; faultCap=1 ----
const RED = { ...E1_NODE, restores: 0, pinOps: 0, admission: false, bulkA: 0, faultCap: 1, lossProp: true };
const REDI = { ...E1_IDB, restores: 0, pinOps: 0, admission: false, bulkA: 0, saveMine: 0, faultCap: 1, lossProp: true };
Object.assign(PRESETS, {
  r_base: { ...RED },
  r_fixRec: { ...RED, recFix: 'rec' },
  r_fixCur: { ...RED, recFix: 'cur' },
  r_fixRec_direct: { ...RED, recFix: 'rec', recDirect: true },
  r_fixCur_direct: { ...RED, recFix: 'cur', recDirect: true },
  ri_base: { ...REDI },
  ri_fixRec: { ...REDI, recFix: 'rec' },
  ri_fixCur: { ...REDI, recFix: 'cur' },
});

Object.assign(PRESETS, { r_fixRec_nochk: { ...PRESETS.r_fixRec, recNoCheck: true }, r_fixCur_nochk: { ...PRESETS.r_fixCur, recNoCheck: true } });

Object.assign(PRESETS, {
  r_fixRefuse: { ...PRESETS.r_base, recFix: 'refuse' },
  r_fixRefuse_direct: { ...PRESETS.r_base, recFix: 'refuse', recDirect: true },
  ri_fixRefuse: { ...PRESETS.ri_base, recFix: 'refuse' },
});
