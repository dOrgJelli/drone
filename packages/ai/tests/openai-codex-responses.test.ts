import { describe, expect, test } from "vitest";
import { codexPromptCacheKey } from "../src/providers/openai-codex-responses.js";

describe("openai codex responses", () => {
	test("shortens prompt cache keys to the provider limit", () => {
		const sessionId = "vsn-usr_7685a53fc3a6461b9257b775ad0db9b6-thr_d25719c89846407d8888a0bce6dd1539";
		const key = codexPromptCacheKey(sessionId);

		expect(key).toBeDefined();
		expect(key!.length).toBeLessThanOrEqual(64);
		expect(key).not.toBe(sessionId);
	});

	test("keeps short prompt cache keys unchanged", () => {
		expect(codexPromptCacheKey("short-session")).toBe("short-session");
		expect(codexPromptCacheKey(undefined)).toBeUndefined();
	});
});
