/**
 * Tests for lists commands with mocked SDK client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerListsCommand, registerListCommand } from "../commands/lists.js";

vi.mock("../lib/api.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../lib/resolve.js", () => ({
  resolveAuthenticatedUserId: vi.fn(),
  resolveUserId: vi.fn(),
}));

vi.mock("../lib/cost.js", () => ({
  logApiCall: vi.fn(),
  formatCostFooter: vi.fn(() => ""),
  estimateCost: vi.fn(() => 0),
  loadUsageLog: vi.fn(() => []),
  computeTodaySpend: vi.fn(() => 0),
}));

vi.mock("../lib/budget.js", () => ({
  checkBudget: vi.fn(),
  loadBudget: vi.fn(() => ({ action: "warn" })),
}));

import { getClient } from "../lib/api.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";

describe("lists command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerListsCommand(program);
    vi.clearAllMocks();
  });

  it("lists owned lists", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    const mockGetOwned = vi.fn().mockResolvedValue({
      data: [
        { id: "list1", name: "My List", memberCount: 10, followerCount: 5 },
      ],
    });

    vi.mocked(getClient).mockResolvedValue({
      users: { getOwnedLists: mockGetOwned },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "lists"]);

    expect(mockGetOwned).toHaveBeenCalledWith("myid", expect.anything());
    expect(logSpy).toHaveBeenCalledWith("Your lists:\n");
    logSpy.mockRestore();
  });

  it("shows message when no lists exist", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    const mockGetOwned = vi.fn().mockResolvedValue({ data: [] });

    vi.mocked(getClient).mockResolvedValue({
      users: { getOwnedLists: mockGetOwned },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "lists"]);

    expect(logSpy).toHaveBeenCalledWith("No lists found.");
    logSpy.mockRestore();
  });
});

describe("list command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerListCommand(program);
    vi.clearAllMocks();
  });

  it("shows posts in a list", async () => {
    const mockGetPosts = vi.fn().mockResolvedValue({
      data: [
        {
          id: "t1",
          text: "list post",
          authorId: "u1",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
      includes: {
        users: [{ id: "u1", username: "alice", name: "Alice" }],
      },
    });

    vi.mocked(getClient).mockResolvedValue({
      lists: { getPosts: mockGetPosts },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "list", "12345"]);

    expect(mockGetPosts).toHaveBeenCalledWith("12345", expect.objectContaining({
      maxResults: 20,
    }));
    logSpy.mockRestore();
  });
});
