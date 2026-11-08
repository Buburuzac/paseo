// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamViewportHandle } from "../strategy";
import { useTimelineSearch } from "./use-timeline-search";

const runtime = vi.hoisted(() => ({
  searchAgentTimeline: vi.fn(),
  fetchAgentTimeline: vi.fn(),
}));

vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => runtime,
    fetchAgentTimeline: runtime.fetchAgentTimeline,
  }),
}));

function hit(seq: number) {
  return {
    seq,
    timestamp: "2026-03-01T12:00:00.000Z",
    kind: "assistant_message" as const,
    preview: `hit ${seq}`,
    ranges: [{ start: 0, length: 3 }],
    matchCount: 1,
  };
}

function response(hits: ReturnType<typeof hit>[], query: string, truncated = false) {
  return { requestId: "req", agentId: "agent-1", epoch: "epoch-1", query, hits, truncated };
}

function renderSearch(props?: { timelineEpoch?: string }) {
  const viewportRef = createRef<StreamViewportHandle>();
  const scrollToMessage = vi.fn();
  viewportRef.current = {
    scrollToBottom: vi.fn(),
    prepareForViewportChange: vi.fn(),
    scrollToMessage,
    holdRow: vi.fn(),
  };
  const rendered = renderHook(
    ({ timelineEpoch }) =>
      useTimelineSearch({
        agentId: "agent-1",
        serverId: "server-1",
        timelineEpoch,
        tail: [],
        head: [],
        enabled: true,
        viewportRef,
        onJumpError: vi.fn(),
      }),
    { initialProps: { timelineEpoch: props?.timelineEpoch ?? "epoch-1" } },
  );
  return { ...rendered, scrollToMessage };
}

/**
 * Fires the debounce timer, then lets the response promise settle. `waitFor` cannot be
 * used here: it polls on real timers, which fake timers have stopped.
 */
async function flushSearch() {
  await act(async () => {
    vi.runAllTimers();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useTimelineSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runtime.searchAgentTimeline.mockReset();
    runtime.fetchAgentTimeline.mockReset();
    runtime.fetchAgentTimeline.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not query the daemon until the query clears the minimum length", async () => {
    const { result } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("a"));
    await flushSearch();

    expect(runtime.searchAgentTimeline).not.toHaveBeenCalled();
    expect(result.current.hits).toEqual([]);
  });

  it("searches a debounced query once and lands on the first hit", async () => {
    runtime.searchAgentTimeline.mockResolvedValue(response([hit(4), hit(9)], "parser"));
    const { result } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("pars"));
    act(() => result.current.setQuery("parser"));
    await flushSearch();

    expect(runtime.searchAgentTimeline).toHaveBeenCalledTimes(1);
    expect(runtime.searchAgentTimeline).toHaveBeenCalledWith("agent-1", "parser");
    expect(result.current.hits).toHaveLength(2);
    expect(result.current.activeIndex).toBe(0);
  });

  it("drops a response for a query the user has already typed past", async () => {
    runtime.searchAgentTimeline.mockResolvedValue(response([hit(1)], "stale"));
    const { result } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("fresh"));
    await flushSearch();

    expect(result.current.hits).toEqual([]);
  });

  it("fetches the window around a hit that is not loaded", async () => {
    runtime.searchAgentTimeline.mockResolvedValue(response([hit(4), hit(9)], "parser"));
    const { result } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("parser"));
    await flushSearch();
    expect(result.current.hits).toHaveLength(2);

    await act(async () => result.current.goToNextHit());

    expect(result.current.activeIndex).toBe(1);
    expect(runtime.fetchAgentTimeline).toHaveBeenCalledWith(
      "server-1",
      "agent-1",
      expect.objectContaining({ cursor: expect.objectContaining({ epoch: "epoch-1" }) }),
    );
  });

  it("wraps from the last hit back to the first", async () => {
    runtime.searchAgentTimeline.mockResolvedValue(response([hit(4), hit(9)], "parser"));
    const { result } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("parser"));
    await flushSearch();
    expect(result.current.hits).toHaveLength(2);

    await act(async () => result.current.goToNextHit());
    await act(async () => result.current.goToNextHit());

    expect(result.current.activeIndex).toBe(0);
  });

  it("clears the hits when the timeline is replaced under it", async () => {
    runtime.searchAgentTimeline.mockResolvedValue(response([hit(4)], "parser"));
    const { result, rerender } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("parser"));
    await flushSearch();
    expect(result.current.hits).toHaveLength(1);

    rerender({ timelineEpoch: "epoch-2" });

    expect(result.current.hits).toEqual([]);
    expect(result.current.activeIndex).toBe(-1);
  });

  it("closing forgets the query and the hits", async () => {
    runtime.searchAgentTimeline.mockResolvedValue(response([hit(4)], "parser"));
    const { result } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("parser"));
    await flushSearch();
    expect(result.current.hits).toHaveLength(1);

    act(() => result.current.close());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.hits).toEqual([]);
  });

  it("reports a failed search instead of showing an empty result", async () => {
    runtime.searchAgentTimeline.mockRejectedValue(new Error("host is offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderSearch();

    act(() => result.current.open());
    act(() => result.current.setQuery("parser"));
    await flushSearch();

    expect(result.current.failed).toBe(true);
    expect(result.current.isSearching).toBe(false);
  });
});
