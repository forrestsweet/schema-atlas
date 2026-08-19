"use client";

import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import type { FC } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SchemaThreadListProps = {
  onSelect: () => void;
};

export const SchemaThreadList: FC<SchemaThreadListProps> = ({ onSelect }) => {
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const visibleThreadCount = useAuiState(
    (state) =>
      Object.values(state.threads.threadItems).filter((thread) =>
        thread.title?.trim(),
      ).length,
  );

  return (
    <ThreadListPrimitive.Root className="flex h-full min-h-0 flex-col gap-3 p-3">
      <ThreadListPrimitive.New asChild>
        <Button variant="outline" className="w-full justify-start" onClick={onSelect}>
          <Plus />
          新建会话
        </Button>
      </ThreadListPrimitive.New>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
          </div>
        ) : visibleThreadCount === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            暂无历史会话
          </div>
        ) : (
          <div className="space-y-1">
            <ThreadListPrimitive.Items>
              {() => <SchemaThreadListItem onSelect={onSelect} />}
            </ThreadListPrimitive.Items>
          </div>
        )}
      </div>
    </ThreadListPrimitive.Root>
  );
};

const SchemaThreadListItem: FC<SchemaThreadListProps> = ({ onSelect }) => {
  const title = useAuiState((state) => state.threadListItem.title?.trim());

  if (!title) return null;

  return (
    <ThreadListItemPrimitive.Root className="group flex items-center rounded-md data-[active]:bg-accent">
      <ThreadListItemPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          className="min-w-0 flex-1 justify-start px-2 font-normal"
          onClick={onSelect}
        >
          <MessageSquare className="shrink-0 text-muted-foreground" />
          <span className="truncate text-left">
            <ThreadListItemPrimitive.Title />
          </span>
        </Button>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemPrimitive.Delete asChild>
        <Button
          variant="ghost"
          size="icon"
          className="mr-1 size-8 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="删除会话"
        >
          <Trash2 />
        </Button>
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
};
