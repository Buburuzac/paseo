import type { DropdownMenuItemSelectEvent } from "@/components/ui/dropdown-menu";
import { shouldOpenPromptInNewChat } from "@/prompts/prompt-insertion";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { generateMessageId } from "@/types/stream";
import type { ShortcutOs } from "@/utils/format-shortcut";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";

interface OpenReviewChatInput {
  serverId: string;
  workspaceId: string | null | undefined;
  cwd: string;
  text: string;
  provider: string;
  model: string;
  event: DropdownMenuItemSelectEvent;
  shortcutOs: ShortcutOs;
  generateDraftId?: () => string;
  generateClientMessageId?: () => string;
  now?: () => number;
}

export function openReviewChat(input: OpenReviewChatInput): void {
  const draftId = (input.generateDraftId ?? generateDraftId)();
  const provider = input.provider.trim();
  const setup: WorkspaceDraftTabSetup | undefined = provider
    ? {
        provider,
        cwd: input.cwd,
        model: input.model.trim() || null,
        modeId: null,
        thinkingOptionId: null,
        providerOptions: {},
      }
    : undefined;
  const target = normalizeWorkspaceTabTarget({ kind: "draft", draftId, setup });
  if (!target) return;

  const persistenceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId ?? input.cwd,
  });
  if (!persistenceKey) return;

  const shouldAutoStart = !shouldOpenPromptInNewChat(input.event, input.shortcutOs);
  const resolvedWorkspaceId = input.workspaceId?.trim();
  if (shouldAutoStart && resolvedWorkspaceId) {
    const clientMessageId = (input.generateClientMessageId ?? generateMessageId)();
    const timestamp = (input.now ?? Date.now)();
    useCreateFlowStore.getState().setPending({
      serverId: input.serverId,
      draftId,
      workspaceId: resolvedWorkspaceId,
      agentId: null,
      clientMessageId,
      text: input.text,
      timestamp,
    });
    useWorkspaceDraftSubmissionStore.getState().setPending({
      serverId: input.serverId,
      workspaceId: resolvedWorkspaceId,
      draftId,
      text: input.text,
      attachments: [],
      cwd: input.cwd,
      ...(provider ? { provider } : {}),
      clientMessageId,
      timestamp,
    });
  } else {
    useDraftStore.getState().saveDraftInput({
      draftKey: buildDraftStoreKey({ serverId: input.serverId, agentId: draftId, draftId }),
      draft: { text: input.text, attachments: [] },
    });
  }
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: persistenceKey,
    target,
    intent: "reveal",
  });
}
