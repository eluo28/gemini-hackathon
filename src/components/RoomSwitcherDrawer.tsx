import { useEffect, useState } from 'react';
import { Clock, Eye, RefreshCw, Trash2, Users, Video, X } from 'lucide-react';
import { validateDisplayName } from '../utils/streamUtils';
import { filterAndSortDirectoryRooms, formatRelativeTime } from '../utils/roomLifecycle';
import type { ParticipantRole, RecentRoomEntry, RoomSummary, StreamCategory } from '../utils/types';
import type { StudioProfile } from '../hooks/useStudioRoom';

interface RoomSwitcherDrawerProps {
  roomId: string;
  selfName: string;
  selfRole: ParticipantRole;
  directoryRooms: RoomSummary[];
  recentRooms: RecentRoomEntry[];
  onClose: () => void;
  onRefreshDirectory: () => void;
  onRemoveRecentRoom: (roomId: string) => void;
  onClearRecentRooms: () => void;
  onJoinRoom: (
    roomId: string,
    profile: StudioProfile,
    meta?: { title?: string; category?: StreamCategory }
  ) => void;
}

export function RoomSwitcherDrawer({
  roomId,
  selfName,
  selfRole,
  directoryRooms,
  recentRooms,
  onClose,
  onRefreshDirectory,
  onRemoveRecentRoom,
  onClearRecentRooms,
  onJoinRoom,
}: RoomSwitcherDrawerProps) {
  const [nameInput, setNameInput] = useState(selfName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState(roomId);
  const [roleInput, setRoleInput] = useState<ParticipantRole>(selfRole);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setNameInput(selfName);
  }, [selfName]);

  useEffect(() => {
    setRoleInput(selfRole);
  }, [selfRole]);

  useEffect(() => {
    setRoomInput(roomId);
  }, [roomId]);

  useEffect(() => {
    setNowMs(Date.now());
    onRefreshDirectory();
    const timer = window.setInterval(() => setNowMs(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [onRefreshDirectory]);

  const sortedDirectory = filterAndSortDirectoryRooms(directoryRooms);
  const otherActiveRooms = sortedDirectory.filter((r) => r.roomId !== roomId);
  const activeById = new Map(directoryRooms.map((r) => [r.roomId, r]));

  const switchDirectly = (targetRoomId: string, targetRole: ParticipantRole) => {
    const check = validateDisplayName(nameInput || selfName);
    if (!check.ok) {
      setNameError(check.reason);
      return;
    }
    setNameError(null);
    onJoinRoom(targetRoomId, {
      name: check.name,
      handle: '',
      role: targetRole,
    });
    onClose();
  };

  const handleRoomSwitch = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateDisplayName(nameInput);
    if (!check.ok) {
      setNameError(check.reason);
      return;
    }
    setNameError(null);
    onJoinRoom(roomInput, {
      name: check.name,
      handle: '',
      role: roleInput,
    });
    onClose();
  };

  return (
    <div
      data-testid="room-switcher-drawer"
      className="px-5 md:px-7 py-5 bg-white border-b border-slate-200/90 space-y-5 shadow-xs"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-950">
            Browse &amp; Switch Rooms
          </h2>
          <p className="text-xs text-slate-500">
            Jump to another active stream, rejoin a recent room, or enter a room code.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefreshDirectory}
            aria-label="Refresh rooms list"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close room switcher"
            className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Other Available Active Rooms */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              Available Rooms ({otherActiveRooms.length})
            </span>
          </div>

          {otherActiveRooms.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              No other channels are active right now.
            </p>
          ) : (
            <div className="space-y-2 max-h-44 overflow-y-auto pr-0.5">
              {otherActiveRooms.map((r) => (
                <div
                  key={r.roomId}
                  className="bg-white border border-slate-200/80 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {r.title}
                      </span>
                      {r.isLive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-rose-600 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                          LIVE
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          Backstage
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate tabular-nums">
                      {r.hostName} · {r.category} · {r.broadcasterCount} stage · {r.viewerCount}{' '}
                      watching
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => switchDirectly(r.roomId, 'viewer')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors"
                    >
                      <Eye className="w-3 h-3" aria-hidden="true" />
                      <span>Watch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => switchDirectly(r.roomId, 'cohost')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-lg transition-colors"
                    >
                      <Video className="w-3 h-3" aria-hidden="true" />
                      <span>Stage</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Room History */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              Recent Rooms ({recentRooms.length})
            </span>
            {recentRooms.length > 0 && (
              <button
                type="button"
                onClick={onClearRecentRooms}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-rose-600 transition-colors"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                <span>Clear</span>
              </button>
            )}
          </div>

          {recentRooms.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              Rooms you visit will appear here for quick rejoining.
            </p>
          ) : (
            <div className="space-y-2 max-h-44 overflow-y-auto pr-0.5">
              {recentRooms.map((item) => {
                const liveInfo = activeById.get(item.roomId);
                const isCurrent = item.roomId === roomId;
                return (
                  <div
                    key={item.roomId}
                    className="bg-white border border-slate-200/80 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {liveInfo?.title || item.title}
                        </span>
                        {liveInfo?.isLive ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-rose-600 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                            LIVE
                          </span>
                        ) : liveInfo ? (
                          <span className="text-[10px] font-mono text-emerald-700 shrink-0">
                            Active ({liveInfo.broadcasterCount + liveInfo.viewerCount})
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            Offline
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        <span className="font-mono text-slate-600">/{item.roomId}</span> ·{' '}
                        {formatRelativeTime(item.lastVisitedAt, nowMs)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isCurrent ? (
                        <span className="px-2 py-1 text-[11px] font-medium text-slate-500 bg-slate-100 rounded-lg">
                          Current
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            switchDirectly(
                              item.roomId,
                              item.lastRole === 'viewer' ? 'viewer' : 'cohost'
                            )
                          }
                          className="px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-950 text-slate-900 hover:text-white rounded-lg transition-colors"
                        >
                          Rejoin
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveRecentRoom(item.roomId)}
                        aria-label={`Remove ${item.title} from history`}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Join by Room Code / Switch Role */}
      <form
        onSubmit={handleRoomSwitch}
        noValidate
        className="pt-3.5 border-t border-slate-100 flex flex-wrap items-end gap-3"
      >
        <div className="min-w-[150px] flex-1">
          <label htmlFor="studio-name" className="block text-xs font-medium text-slate-600 mb-1">
            Display Name
          </label>
          <input
            id="studio-name"
            type="text"
            required
            maxLength={32}
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="Enter your name"
            className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs text-slate-950 focus:bg-white focus:outline-none transition-colors ${
              nameError
                ? 'border-rose-400 focus:border-rose-600'
                : 'border-slate-200 focus:border-slate-900'
            }`}
          />
        </div>
        <div className="min-w-[150px] flex-1">
          <label htmlFor="studio-room" className="block text-xs font-medium text-slate-600 mb-1">
            Room Code / Slug
          </label>
          <input
            id="studio-room"
            type="text"
            required
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
          />
        </div>
        <div className="min-w-[165px]">
          <label htmlFor="studio-role" className="block text-xs font-medium text-slate-600 mb-1">
            Role
          </label>
          <select
            id="studio-role"
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value as ParticipantRole)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-950 focus:bg-white focus:outline-none focus:border-slate-900 transition-colors"
          >
            <option value="host">Host (Camera + Mic)</option>
            <option value="cohost">Co-Host (On Stage)</option>
            <option value="viewer">Viewer (Watch &amp; Chat)</option>
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors whitespace-nowrap"
        >
          Join Room
        </button>
      </form>

      {nameError && (
        <p role="alert" className="text-xs text-rose-600 font-medium">
          {nameError}
        </p>
      )}
    </div>
  );
}
