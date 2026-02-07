/**
 * Tests for followers/following/follow/unfollow commands.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import {
  registerFollowersCommand,
  registerFollowingCommand,
  registerFollowCommand,
  registerUnfollowCommand,
} from "../commands/followers.js";

vi.mock("../lib/api.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../lib/resolve.js", () => ({
  resolveUserId: vi.fn(),
  resolveAuthenticatedUserId: vi.fn(),
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
import { resolveUserId, resolveAuthenticatedUserId } from "../lib/resolve.js";

describe("followers command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerFollowersCommand(program);
    vi.clearAllMocks();
  });

  it("lists followers of a user", async () => {
    vi.mocked(resolveUserId).mockResolvedValue("uid1");
    const mockGetFollowers = vi.fn().mockResolvedValue({
      data: [
        { id: "f1", username: "fan1", name: "Fan One" },
        { id: "f2", username: "fan2", name: "Fan Two" },
      ],
    });

    vi.mocked(getClient).mockResolvedValue({
      users: { getFollowers: mockGetFollowers },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "followers", "@alice"]);

    expect(resolveUserId).toHaveBeenCalledWith("@alice", undefined);
    expect(mockGetFollowers).toHaveBeenCalledWith("uid1", expect.objectContaining({
      maxResults: 100,
    }));
    expect(logSpy).toHaveBeenCalledWith("Followers of @alice:\n");
    logSpy.mockRestore();
  });
});

describe("following command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerFollowingCommand(program);
    vi.clearAllMocks();
  });

  it("lists who a user follows", async () => {
    vi.mocked(resolveUserId).mockResolvedValue("uid1");
    const mockGetFollowing = vi.fn().mockResolvedValue({
      data: [{ id: "f1", username: "followed1", name: "Followed" }],
    });

    vi.mocked(getClient).mockResolvedValue({
      users: { getFollowing: mockGetFollowing },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "following", "@bob"]);

    expect(mockGetFollowing).toHaveBeenCalledWith("uid1", expect.objectContaining({
      maxResults: 100,
    }));
    expect(logSpy).toHaveBeenCalledWith("@bob is following:\n");
    logSpy.mockRestore();
  });
});

describe("follow command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerFollowCommand(program);
    vi.clearAllMocks();
  });

  it("follows a user", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    vi.mocked(resolveUserId).mockResolvedValue("target1");
    const mockFollow = vi.fn().mockResolvedValue({ data: { following: true } });

    vi.mocked(getClient).mockResolvedValue({
      users: { followUser: mockFollow },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "follow", "@charlie"]);

    expect(mockFollow).toHaveBeenCalledWith("myid", {
      body: { targetUserId: "target1" },
    });
    expect(logSpy).toHaveBeenCalledWith("Followed @charlie");
    logSpy.mockRestore();
  });
});

describe("unfollow command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerUnfollowCommand(program);
    vi.clearAllMocks();
  });

  it("unfollows a user", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    vi.mocked(resolveUserId).mockResolvedValue("target1");
    const mockUnfollow = vi
      .fn()
      .mockResolvedValue({ data: { following: false } });

    vi.mocked(getClient).mockResolvedValue({
      users: { unfollowUser: mockUnfollow },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "unfollow", "@charlie"]);

    expect(mockUnfollow).toHaveBeenCalledWith("myid", "target1");
    expect(logSpy).toHaveBeenCalledWith("Unfollowed @charlie");
    logSpy.mockRestore();
  });
});
