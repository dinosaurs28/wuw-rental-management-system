import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { employeeApi } from '../lib/api';
import { apiErrorMessage } from '../lib/counterErrors';
import {
  draftKindOf,
  fromDraftPhotos,
  toDraftPhotos,
  type OperationDraft,
  type OperationDraftType,
} from '../lib/operationDraft';
import type { CapturedPhoto } from '../components/employee/PhotoCaptureSection';

// Paused pickup / drop (client item 2). Keeps everything entered on the screen
// saved on the server while it's open (debounced, and on leave / background),
// restores it when the screen opens again, and asks "Continue later / Discard"
// when the Fleet Executive leaves. Completion is never automatic: the screen
// calls completed() after its own explicit confirm succeeded.

const AUTOSAVE_DELAY_MS = 1000;

export interface OperationDraftSnapshot {
  // The screen's own fields (stored as-is, read back with lib/operationDraft readers).
  data: Record<string, unknown>;
  photos: CapturedPhoto[];
}

interface Options {
  type: OperationDraftType;
  bookingId: string | undefined;
  // The form is open for editing: booking loaded, at this step, not finished.
  enabled: boolean;
  schemaVersion: number;
  snapshot: OperationDraftSnapshot;
  // Nothing typed / taken yet — no draft is created for an untouched form.
  isEmpty: boolean;
  // Photos still uploading (or failed): they aren't in the snapshot yet.
  pendingUploads: number;
  // Put the saved fields back on the screen (once, when it opens).
  onRestore: (draft: OperationDraft, photos: CapturedPhoto[]) => void;
  // The booking moved past this step elsewhere (409 DRAFT_NOT_ALLOWED) — reload it.
  onGone?: () => void;
}

type SaveResult = 'saved' | 'skipped' | 'failed' | 'conflict' | 'retry';

export interface OperationDraftController {
  // Header "Continue later" can be offered (the server keeps drafts).
  canPause: boolean;
  // The form was restored from a saved draft: when and by whom it was saved.
  resumed: { updatedAt: string; updatedByName: string | null } | null;
  dismissResumed: () => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: string | null;
  // Save now and leave the screen (warns about photos still uploading).
  continueLater: () => void;
  // Call right before the explicit complete request: stops autosave and waits
  // for a save already on its way, so none lands during / after completion.
  beginCompletion: () => Promise<void>;
  // The complete request failed (or didn't finish the operation): saving resumes.
  abortCompletion: () => void;
  // The pickup / drop was completed (the server already deleted the draft).
  completed: () => void;
}

export function useOperationDraft({
  type,
  bookingId,
  enabled,
  schemaVersion,
  snapshot,
  isEmpty,
  pendingUploads,
  onRestore,
  onGone,
}: Options): OperationDraftController {
  const navigation = useNavigation();
  const qc = useQueryClient();
  const kind = draftKindOf(type);
  const noun = type === 'PICKUP' ? 'pickup' : 'drop';

  // The initial read finished (found or not) — nothing is saved before it, so
  // a draft from another phone can't be overwritten unseen.
  const [ready, setReady] = useState(false);
  // false on a server without draft endpoints: the screen works as before.
  const [available, setAvailable] = useState(true);
  const [hasDraft, setHasDraft] = useState(false);
  const [done, setDone] = useState(false);
  const [resumed, setResumed] = useState<OperationDraftController['resumed']>(null);
  const [saveState, setSaveState] = useState<OperationDraftController['saveState']>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  // Bumped per restore: the first state after it is what the server already has.
  const [restoreGen, setRestoreGen] = useState(0);

  const mountedRef = useRef(true);
  const readyRef = useRef(false);
  const availableRef = useRef(true);
  const hasDraftRef = useRef(false);
  const doneRef = useRef(false);
  // Between beginCompletion() and completed() / abortCompletion().
  const completingRef = useRef(false);
  const conflictRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const startedRef = useRef(false);
  // Server version the next save builds on (0 = none known).
  const versionRef = useRef(0);
  // What was last saved (or restored), to skip identical saves.
  const savedKeyRef = useRef<string | null>(null);
  const adoptedGenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<SaveResult> | null>(null);
  // Identifies this screen session's saves to the server (see writerId).
  const writerIdRef = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  // Latest values for the async paths (timers, AppState, unmount).
  const latest = useRef({ snapshot, isEmpty, enabled, pendingUploads, onRestore, onGone });
  latest.current = { snapshot, isEmpty, enabled, pendingUploads, onRestore, onGone };

  const photoRefs = toDraftPhotos(snapshot.photos);
  const snapshotKey = JSON.stringify({ d: snapshot.data, p: photoRefs });

  useEffect(() => () => { mountedRef.current = false; }, []);

  const markHasDraft = (value: boolean) => {
    hasDraftRef.current = value;
    if (mountedRef.current) setHasDraft(value);
  };

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['employee', 'operation-drafts'] });
    qc.invalidateQueries({ queryKey: ['employee', type === 'PICKUP' ? 'pickups' : 'returns'] });
  };

  const applyDraft = (draft: OperationDraft) => {
    versionRef.current = draft.version;
    markHasDraft(true);
    latest.current.onRestore(draft, fromDraftPhotos(draft.photos));
    if (mountedRef.current) {
      setRestoreGen((g) => g + 1);
      setResumed({ updatedAt: draft.updatedAt, updatedByName: draft.updatedBy?.name ?? null });
      setLastSavedAt(draft.updatedAt);
    }
  };

  const showConflict = (server: OperationDraft | null, message: string) => {
    conflictRef.current = true;
    Alert.alert(
      'Saved on another phone',
      `${message}\n\nLoad that version, or keep what's on this phone (it replaces the other one).`,
      [
        {
          text: 'Keep mine',
          onPress: () => {
            conflictRef.current = false;
            versionRef.current = server?.version ?? 0;
            savedKeyRef.current = null;
            void saveRef.current();
          },
        },
        {
          text: 'Load saved',
          onPress: () => {
            conflictRef.current = false;
            if (server) applyDraft(server);
          },
        },
      ],
      { cancelable: false },
    );
  };

  const save = async (retried = false): Promise<SaveResult> => {
    if (
      !bookingId || !readyRef.current || !availableRef.current || doneRef.current ||
      completingRef.current || conflictRef.current || !latest.current.enabled
    ) {
      return 'skipped';
    }
    if (inFlightRef.current) {
      await inFlightRef.current.catch(() => 'failed');
      return save(retried);
    }
    const snap = latest.current.snapshot;
    const photos = toDraftPhotos(snap.photos);
    const key = JSON.stringify({ d: snap.data, p: photos });
    if (key === savedKeyRef.current) return 'skipped';
    // An untouched form leaves nothing behind (no "Paused" for a peek).
    if (latest.current.isEmpty && !hasDraftRef.current) return 'skipped';

    const run = (async (): Promise<SaveResult> => {
      if (mountedRef.current) setSaveState('saving');
      try {
        const res = await employeeApi.saveOperationDraft(kind, bookingId, {
          schemaVersion,
          data: snap.data,
          photos,
          baseVersion: versionRef.current,
          writerId: writerIdRef.current,
        });
        const meta = res.data?.data;
        if (meta) versionRef.current = meta.version;
        savedKeyRef.current = key;
        const created = !hasDraftRef.current;
        markHasDraft(true);
        if (created) refreshLists();
        if (mountedRef.current) {
          setSaveState('saved');
          if (meta) setLastSavedAt(meta.updatedAt);
        }
        return 'saved';
      } catch (err: any) {
        // Completing / completed meanwhile: whatever this save hit no longer matters
        // (an aborted completion saves again).
        if (completingRef.current || doneRef.current) {
          if (mountedRef.current) setSaveState('idle');
          return 'skipped';
        }
        const status = err?.response?.status;
        const code = err?.response?.data?.code;
        if (code === 'DRAFT_CONFLICT') {
          const server = (err.response.data.draft ?? null) as OperationDraft | null;
          if (!server) {
            // The draft is gone (discarded elsewhere, or the booking moved on):
            // start a new one once, which the server refuses if it moved on.
            versionRef.current = 0;
            savedKeyRef.current = null;
            markHasDraft(false);
            if (!retried) return 'retry';
            if (mountedRef.current) setSaveState('error');
            return 'failed';
          }
          if (mountedRef.current) {
            setSaveState('error');
            showConflict(server, apiErrorMessage(err, `This ${noun} was saved from another phone.`));
          }
          return 'conflict';
        }
        if (mountedRef.current) setSaveState('error');
        if (code === 'DRAFT_NOT_ALLOWED') {
          // Completed / cancelled elsewhere: nothing left to pause.
          doneRef.current = true;
          if (mountedRef.current) setDone(true);
          latest.current.onGone?.();
          return 'skipped';
        }
        if (status === 404 && !code) {
          availableRef.current = false;
          if (mountedRef.current) setAvailable(false);
        }
        return 'failed';
      }
    })();
    inFlightRef.current = run;
    let result: SaveResult;
    try {
      result = await run;
    } finally {
      if (inFlightRef.current === run) inFlightRef.current = null;
    }
    return result === 'retry' ? save(true) : result;
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Read the saved draft once the form opens.
  useEffect(() => {
    if (!bookingId || !enabled || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await employeeApi.getOperationDraft(kind, bookingId);
        const draft = res.data?.data ?? null;
        if (draft && mountedRef.current) applyDraft(draft);
      } catch (err: any) {
        // No draft endpoints on this server: keep the screen as it was.
        if (err?.response?.status === 404) {
          availableRef.current = false;
          if (mountedRef.current) setAvailable(false);
        }
        // Otherwise (offline…) start from the screen; a later save to an
        // existing draft comes back as a conflict, so nothing is overwritten.
      } finally {
        readyRef.current = true;
        if (mountedRef.current) setReady(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, enabled]);

  // Autosave, debounced.
  useEffect(() => {
    if (!ready || !available || done || !enabled) return;
    if (adoptedGenRef.current !== restoreGen) {
      // The first state after a restore is what the server already has.
      adoptedGenRef.current = restoreGen;
      savedKeyRef.current = snapshotKey;
      return;
    }
    if (snapshotKey === savedKeyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, [snapshotKey, ready, available, done, enabled, restoreGen]);

  // Save right away when the screen loses focus, the app goes to the
  // background, or the screen closes.
  useEffect(() => {
    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void saveRef.current();
    };
    const appSub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') flush();
    });
    const blurSub = navigation.addListener('blur', flush);
    return () => {
      appSub.remove();
      blurSub();
      flush();
    };
  }, [navigation]);

  const leave = (go: () => void) => {
    allowLeaveRef.current = true;
    go();
  };

  const leaveSaved = async (go: () => void) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const result = await save();
    if (result === 'conflict') return;
    if (result !== 'failed') {
      leave(go);
      return;
    }
    Alert.alert(
      "Couldn't save",
      'Check the connection and try again. If you leave now, what was entered since the last save is lost.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave anyway', style: 'destructive', onPress: () => leave(go) },
      ],
    );
  };

  const discardAndLeave = async (go: () => void) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Nothing more is saved from this screen (the unmount flush included).
    doneRef.current = true;
    try {
      // A save still on its way would bring the draft back after the delete.
      if (inFlightRef.current) await inFlightRef.current.catch(() => 'failed');
      // Always sent: a draft may exist even if the first read failed (no-op otherwise).
      if (bookingId) await employeeApi.discardOperationDraft(kind, bookingId);
      refreshLists();
      leave(go);
    } catch (err: any) {
      doneRef.current = false;
      Alert.alert('Could not discard', apiErrorMessage(err, 'Please try again.'), [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave anyway', onPress: () => leave(go) },
      ]);
    }
  };

  const confirmDiscard = (go: () => void) => {
    Alert.alert(
      'Discard saved progress?',
      `The readings, choices and photos entered for this ${noun} are cleared. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { void discardAndLeave(go); } },
      ],
    );
  };

  const uploadsWarning = (count: number) =>
    count > 0
      ? `\n\n${count} photo${count > 1 ? 's are' : ' is'} still uploading and will be lost if you leave now.`
      : '';

  // Leaving with something entered: keep it for later (default) or discard it.
  const guard = enabled && ready && available && !done && (hasDraft || !isEmpty);
  usePreventRemove(guard, ({ data }) => {
    if (allowLeaveRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    const go = () => navigation.dispatch(data.action);
    Alert.alert(
      `Leave this ${noun}?`,
      `Continue later keeps everything entered so far, photos included — resume it from the queue. Nothing is completed until you confirm the ${noun}.${uploadsWarning(latest.current.pendingUploads)}`,
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => confirmDiscard(go) },
        { text: 'Continue later', onPress: () => { void leaveSaved(go); } },
      ],
    );
  });

  const continueLater = () => {
    const go = () => navigation.goBack();
    if (!guard) {
      leave(go);
      return;
    }
    const pending = latest.current.pendingUploads;
    if (pending > 0) {
      Alert.alert('Photos still uploading', uploadsWarning(pending).trim(), [
        { text: 'Wait', style: 'cancel' },
        { text: 'Leave anyway', style: 'destructive', onPress: () => { void leaveSaved(go); } },
      ]);
      return;
    }
    void leaveSaved(go);
  };

  const beginCompletion = async () => {
    completingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) await inFlightRef.current.catch(() => 'failed');
  };

  const abortCompletion = () => {
    if (doneRef.current || !completingRef.current) return;
    completingRef.current = false;
    // Save anything entered since autosave stopped.
    void saveRef.current();
  };

  const completed = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    completingRef.current = false;
    doneRef.current = true;
    if (mountedRef.current) setDone(true);
    markHasDraft(false);
    refreshLists();
  };

  return {
    canPause: enabled && ready && available && !done,
    resumed,
    dismissResumed: () => setResumed(null),
    saveState,
    lastSavedAt,
    continueLater,
    beginCompletion,
    abortCompletion,
    completed,
  };
}
