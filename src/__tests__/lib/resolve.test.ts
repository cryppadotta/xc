/**
 * Tests for user ID resolution with mocked SDK client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../../lib/api.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../../lib/config.js", () => ({
  getAccount: vi.fn(),
  loadConfig: vi.fn(() => ({ defaultAccount: "default", accounts: {} })),
  saveConfig: vi.fn(),
}));

import { getClient } from "../../lib/api.js";
import { getAccount, loadConfig, saveConfig } from "../../lib/config.js";
import {
  resolveUserId,
  resolveAuthenticatedUserId,
} from "../../lib/resolve.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveUserId", () => {
  it("strips @ prefix and calls SDK getByUsername", async () => {
    const mockGetByUsername = vi.fn().mockResolvedValue({
      data: { id: "user123", username: "testuser" },
    });
    vi.mocked(getClient).mockResolvedValue({
      users: { getByUsername: mockGetByUsername },
    } as any);

    const id = await resolveUserId("@testuser");
    expect(id).toBe("user123");
    expect(mockGetByUsername).toHaveBeenCalledWith("testuser");
  });

  it("handles username without @ prefix", async () => {
    const mockGetByUsername = vi.fn().mockResolvedValue({
      data: { id: "user456" },
    });
    vi.mocked(getClient).mockResolvedValue({
      users: { getByUsername: mockGetByUsername },
    } as any);

    const id = await resolveUserId("plainuser");
    expect(id).toBe("user456");
    expect(mockGetByUsername).toHaveBeenCalledWith("plainuser");
  });

  it("throws when user not found", async () => {
    vi.mocked(getClient).mockResolvedValue({
      users: { getByUsername: vi.fn().mockResolvedValue({ data: {} }) },
    } as any);

    await expect(resolveUserId("@nobody")).rejects.toThrow(
      "User @nobody not found",
    );
  });

  it("passes account name through to getClient", async () => {
    vi.mocked(getClient).mockResolvedValue({
      users: {
        getByUsername: vi.fn().mockResolvedValue({ data: { id: "u1" } }),
      },
    } as any);

    await resolveUserId("@test", "myaccount");
    expect(getClient).toHaveBeenCalledWith("myaccount");
  });
});

describe("resolveAuthenticatedUserId", () => {
  it("returns cached userId from account config", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "default",
      auth: { type: "oauth2", accessToken: "tok" },
      userId: "cached123",
    });

    const id = await resolveAuthenticatedUserId();
    expect(id).toBe("cached123");
    // Should not call SDK when cached
    expect(getClient).not.toHaveBeenCalled();
  });

  it("fetches userId via SDK when not cached", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "default",
      auth: { type: "oauth2", accessToken: "tok" },
    });

    vi.mocked(loadConfig).mockReturnValue({
      defaultAccount: "default",
      accounts: {
        default: {
          name: "default",
          auth: { type: "oauth2", accessToken: "tok" },
        },
      },
    });

    const mockGetMe = vi.fn().mockResolvedValue({
      data: { id: "fetched789", username: "myuser" },
    });
    vi.mocked(getClient).mockResolvedValue({
      users: { getMe: mockGetMe },
    } as any);

    const id = await resolveAuthenticatedUserId();
    expect(id).toBe("fetched789");
    expect(mockGetMe).toHaveBeenCalledWith({ userFields: ["id"] });
  });

  it("caches fetched userId in config", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "default",
      auth: { type: "oauth2", accessToken: "tok" },
    });

    vi.mocked(loadConfig).mockReturnValue({
      defaultAccount: "default",
      accounts: {
        default: {
          name: "default",
          auth: { type: "oauth2", accessToken: "tok" },
        },
      },
    });

    vi.mocked(getClient).mockResolvedValue({
      users: {
        getMe: vi.fn().mockResolvedValue({
          data: { id: "uid1", username: "user1" },
        }),
      },
    } as any);

    await resolveAuthenticatedUserId();
    expect(saveConfig).toHaveBeenCalled();
  });

  it("throws when SDK returns no user ID", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "default",
      auth: { type: "oauth2", accessToken: "tok" },
    });

    vi.mocked(getClient).mockResolvedValue({
      users: { getMe: vi.fn().mockResolvedValue({ data: {} }) },
    } as any);

    await expect(resolveAuthenticatedUserId()).rejects.toThrow(
      "Could not resolve authenticated user ID",
    );
  });

  it("passes account name to getClient", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "work",
      auth: { type: "oauth2", accessToken: "tok" },
    });

    vi.mocked(loadConfig).mockReturnValue({
      defaultAccount: "default",
      accounts: {
        work: {
          name: "work",
          auth: { type: "oauth2", accessToken: "tok" },
        },
      },
    });

    vi.mocked(getClient).mockResolvedValue({
      users: {
        getMe: vi.fn().mockResolvedValue({
          data: { id: "uid1", username: "user1" },
        }),
      },
    } as any);

    await resolveAuthenticatedUserId("work");
    expect(getClient).toHaveBeenCalledWith("work");
  });
});
