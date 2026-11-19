// Threaded comments under a location, visit or photo (DESIGN §5.4). The list
// and every permission flag come from the server; `bodyHtml` is sanitized
// there before it reaches innerHTML. Text that looks like coordinates warns
// when the target is shared with friends (§3.4 rule 8).
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { useRouteContext } from "@tanstack/solid-router";
import {
  createCommentFn,
  deleteCommentFn,
  updateCommentFn,
} from "@trespass/server/comments/functions";
import type { CommentTarget } from "@trespass/shared/comments/inputs";
import { type CommentNode, commentTree } from "@trespass/shared/comments/tree";
import { formatDateTime } from "@trespass/shared/format";
import { hasCoordinateLikeText } from "@trespass/shared/geo/coord-leak";
import { m } from "@trespass/shared/paraglide/messages";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ConfirmButton } from "~/components/confirm-dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { commentsQuery, commentsQueryKey } from "~/lib/comments/queries";
import { useHydrated } from "~/lib/hydrated";
import { runAction } from "~/lib/run-action";

function Composer(props: {
  id: string;
  label: string;
  initial?: string;
  submitLabel: string;
  shared: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const hydrated = useHydrated();
  const [body, setBody] = createSignal(props.initial ?? "");
  const [busy, setBusy] = createSignal(false);
  const leak = createMemo(() => props.shared && hasCoordinateLikeText(body()));
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!body().trim() || busy()) return;
    setBusy(true);
    try {
      if (await props.onSubmit(body().trim())) setBody("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="grid gap-2" onSubmit={submit}>
      <label class="sr-only" for={props.id}>
        {props.label}
      </label>
      <Textarea
        id={props.id}
        rows={3}
        placeholder={props.label}
        value={body()}
        onInput={(e) => setBody(e.currentTarget.value)}
        disabled={!hydrated() || busy()}
      />
      <Show when={leak()}>
        <p class="rounded-md border border-destructive p-2 text-sm text-destructive" role="alert">
          {m.location_coord_warning()}
        </p>
      </Show>
      <div class="flex gap-2">
        <Button type="submit" size="sm" disabled={!hydrated() || busy() || !body().trim()}>
          {hydrated() ? props.submitLabel : m.common_loading()}
        </Button>
        <Show when={props.onCancel}>
          <Button type="button" size="sm" variant="ghost" onClick={() => props.onCancel?.()}>
            {m.common_cancel()}
          </Button>
        </Show>
      </div>
    </form>
  );
}

export function CommentThread(props: {
  target: CommentTarget;
  /** The target is visible to friends: warn about coordinates in the text. */
  shared: boolean;
  /** Defaults to "not a guest" (the server checks again). */
  canWrite?: boolean;
}) {
  const qc = useQueryClient();
  const auth = useRouteContext({ from: "/_authed" });
  const canWrite = () => props.canWrite ?? auth().user.role !== "guest";
  const list = useQuery(() => commentsQuery(props.target));
  const tree = createMemo(() => commentTree(list.data ?? []));
  const refresh = () => qc.invalidateQueries({ queryKey: commentsQueryKey(props.target) });

  const create = async (bodyMd: string, parentId?: string) => {
    const r = await runAction(
      () => createCommentFn({ data: { target: props.target, bodyMd, parentId } }),
      { success: m.comments_created() },
    );
    if (r) await refresh();
    return Boolean(r);
  };

  return (
    <section class="grid gap-3" aria-label={m.comments_title()} data-testid="comment-thread">
      <Show
        when={tree().length > 0}
        fallback={<p class="text-sm text-muted-foreground">{m.comments_empty()}</p>}
      >
        <ol class="grid gap-3">
          <For each={tree()}>
            {(node) => (
              <CommentItem
                node={node}
                depth={0}
                shared={props.shared}
                onReply={create}
                onChanged={refresh}
              />
            )}
          </For>
        </ol>
      </Show>
      <Show when={canWrite()}>
        <Composer
          id={`comment-new-${props.target.kind}-${props.target.id}`}
          label={m.comments_placeholder()}
          submitLabel={m.comments_submit()}
          shared={props.shared}
          onSubmit={(body) => create(body)}
        />
      </Show>
    </section>
  );
}

function CommentItem(props: {
  node: CommentNode;
  depth: number;
  shared: boolean;
  onReply: (body: string, parentId: string) => Promise<boolean>;
  onChanged: () => Promise<void>;
}) {
  const c = () => props.node.comment;
  const [replying, setReplying] = createSignal(false);
  const [editing, setEditing] = createSignal(false);

  const save = async (bodyMd: string) => {
    const r = await runAction(() => updateCommentFn({ data: { id: c().id, bodyMd } }), {
      success: m.comments_updated(),
    });
    if (r) {
      setEditing(false);
      await props.onChanged();
    }
    return Boolean(r);
  };

  const remove = async () => {
    const r = await runAction(() => deleteCommentFn({ data: { id: c().id } }), {
      success: m.comments_deleted(),
    });
    if (r) await props.onChanged();
  };

  return (
    <li class={props.depth > 0 ? "border-l-2 pl-3" : ""} data-testid="comment">
      <div class="grid gap-1">
        <p class="text-xs text-muted-foreground">
          <strong class="text-foreground">{c().authorName}</strong> ·{" "}
          {formatDateTime(c().createdAt)}
          <Show when={c().editedAt}> · {m.comments_edited()}</Show>
        </p>
        <Show
          when={!c().deleted}
          fallback={<p class="text-sm italic text-muted-foreground">{m.comments_removed()}</p>}
        >
          <Show
            when={editing()}
            fallback={
              <div class="prose prose-sm max-w-none break-words" innerHTML={c().bodyHtml} />
            }
          >
            <Composer
              id={`comment-edit-${c().id}`}
              label={m.comments_edit()}
              initial={c().bodyMd ?? ""}
              submitLabel={m.common_save()}
              shared={props.shared}
              onSubmit={save}
              onCancel={() => setEditing(false)}
            />
          </Show>
        </Show>
        <div class="flex flex-wrap gap-1">
          <Show when={c().permissions.canReply && !editing()}>
            <Button size="sm" variant="ghost" onClick={() => setReplying(!replying())}>
              {m.comments_reply()}
            </Button>
          </Show>
          <Show when={c().permissions.canEdit && !editing()}>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {m.comments_edit()}
            </Button>
          </Show>
          <Show when={c().permissions.canDelete}>
            <ConfirmButton
              label={m.comments_delete()}
              question={m.comments_delete_confirm()}
              confirmLabel={m.comments_delete()}
              destructive
              variant="ghost"
              onConfirm={remove}
            />
          </Show>
        </div>
        <Show when={replying()}>
          <Composer
            id={`comment-reply-${c().id}`}
            label={m.comments_reply_placeholder({ name: c().authorName })}
            submitLabel={m.comments_reply()}
            shared={props.shared}
            onSubmit={async (body) => {
              const ok = await props.onReply(body, c().id);
              if (ok) setReplying(false);
              return ok;
            }}
            onCancel={() => setReplying(false)}
          />
        </Show>
      </div>
      <Show when={props.node.replies.length > 0}>
        <ol class="mt-2 grid gap-2">
          <For each={props.node.replies}>
            {(child) => (
              <CommentItem
                node={child}
                depth={Math.min(props.depth + 1, 4)}
                shared={props.shared}
                onReply={props.onReply}
                onChanged={props.onChanged}
              />
            )}
          </For>
        </ol>
      </Show>
    </li>
  );
}
