import assert from "node:assert/strict";
import { PcmSpeechSegmenter, buildGroqPrompt, hasTranscriptContent, pcm16leToWav, pcmDurationMs, stripTranscriptCommands } from "../src/stt.js";
import { normalizeWavChunkSizes } from "../src/tts.js";

const pcm = Buffer.alloc(640);
const wav = pcm16leToWav(pcm, 16_000, 1);

assert.equal(wav.toString("ascii", 0, 4), "RIFF");
assert.equal(wav.toString("ascii", 8, 12), "WAVE");
assert.equal(wav.toString("ascii", 12, 16), "fmt ");
assert.equal(wav.readUInt16LE(20), 1);
assert.equal(wav.readUInt16LE(22), 1);
assert.equal(wav.readUInt32LE(24), 16_000);
assert.equal(wav.readUInt16LE(34), 16);
assert.equal(wav.toString("ascii", 36, 40), "data");
assert.equal(wav.readUInt32LE(40), 640);
assert.equal(wav.byteLength, 684);
assert.equal(pcmDurationMs(640, 16_000, 1), 20);

const groqStyleWav = Buffer.from(wav);
groqStyleWav.writeUInt32LE(0xffffffff, 4);
groqStyleWav.writeUInt32LE(0xffffffff, 40);
const normalizedGroqStyleWav = normalizeWavChunkSizes(groqStyleWav);
assert.equal(normalizedGroqStyleWav.readUInt32LE(4), normalizedGroqStyleWav.byteLength - 8);
assert.equal(normalizedGroqStyleWav.readUInt32LE(40), 640);

const segmenter = new PcmSpeechSegmenter({
  sampleRateHz: 16_000,
  channels: 1,
  minSpeechMs: 120,
  minSubmitMs: 800,
  silenceMs: 200,
  shortUtteranceSilenceMs: 500,
  maxSegmentMs: 2_000,
  overlapMs: 100,
  silenceThreshold: 0.01,
  debugVad: false,
});

const firstSegments = [
  ...segmenter.append(tonePcm(140)),
  ...segmenter.append(silencePcm(100)),
  ...segmenter.append(silencePcm(100)),
];
assert.equal(firstSegments.length, 1);
assert.equal(firstSegments[0]!.audioMs, 800);

const secondSegments = [
  ...segmenter.append(tonePcm(140)),
  ...segmenter.append(silencePcm(200)),
];
assert.equal(secondSegments.length, 1);
assert.equal(secondSegments[0]!.audioMs, 800);

const tooShort = new PcmSpeechSegmenter({
  sampleRateHz: 16_000,
  channels: 1,
  minSpeechMs: 120,
  minSubmitMs: 800,
  silenceMs: 200,
  shortUtteranceSilenceMs: 500,
  maxSegmentMs: 2_000,
  overlapMs: 100,
  silenceThreshold: 0.01,
  debugVad: false,
});
const noSegments = [
  ...tooShort.append(tonePcm(80)),
  ...tooShort.append(silencePcm(300)),
];
assert.equal(noSegments.length, 0);
const shortSegment = [
  ...tooShort.append(silencePcm(200)),
];
assert.equal(shortSegment.length, 1);
assert.equal(shortSegment[0]!.audioMs, 800);

const repeatedShort = new PcmSpeechSegmenter({
  sampleRateHz: 16_000,
  channels: 1,
  minSpeechMs: 120,
  minSubmitMs: 800,
  silenceMs: 200,
  shortUtteranceSilenceMs: 500,
  maxSegmentMs: 2_000,
  overlapMs: 0,
  silenceThreshold: 0.01,
  debugVad: false,
});
const repeatedSegments = [
  ...repeatedShort.append(tonePcm(140)),
  ...repeatedShort.append(silencePcm(200)),
  ...repeatedShort.append(tonePcm(140)),
  ...repeatedShort.append(silencePcm(200)),
  ...repeatedShort.append(tonePcm(140)),
  ...repeatedShort.append(silencePcm(200)),
];
assert.equal(repeatedSegments.length, 3);
assert.deepEqual(repeatedSegments.map((segment) => segment.audioMs), [800, 800, 800]);

const prompt = buildGroqPrompt("Prefer numerals for spoken numbers.", "x".repeat(2_000), 896);
assert.ok(prompt);
assert.equal(Array.from(prompt).length, 896);
assert.ok(prompt.startsWith("Prefer numerals"));
assert.ok(prompt.endsWith("x".repeat(20)));

const longConfiguredPrompt = buildGroqPrompt("p".repeat(1_000), "context should be dropped", 896);
assert.ok(longConfiguredPrompt);
assert.equal(Array.from(longConfiguredPrompt).length, 896);
assert.equal(longConfiguredPrompt, "p".repeat(896));

const cleanedWake = stripTranscriptCommands("Hey Sebastian, what am I saying right now?");
assert.equal(cleanedWake.wakeDetected, true);
assert.equal(cleanedWake.sleepDetected, false);
assert.equal(cleanedWake.text, "what am I saying right now?");

const cleanedSleep = stripTranscriptCommands("That's it. This should not include the command.");
assert.equal(cleanedSleep.wakeDetected, false);
assert.equal(cleanedSleep.sleepDetected, true);
assert.equal(cleanedSleep.abortDetected, false);
assert.equal(cleanedSleep.text, "This should not include the command.");

for (const phrase of ["ok stop", "ok, stop", "okay stop", "okay, stop"]) {
  const cleanedAbort = stripTranscriptCommands(`${phrase}. This should be discarded.`);
  assert.equal(cleanedAbort.abortDetected, true);
  assert.equal(cleanedAbort.sleepDetected, false);
  assert.equal(cleanedAbort.text, "This should be discarded.");

  const cleanedOnlyAbort = stripTranscriptCommands(`${phrase}.`);
  assert.equal(cleanedOnlyAbort.abortDetected, true);
  assert.equal(cleanedOnlyAbort.sleepDetected, false);
  assert.equal(cleanedOnlyAbort.text, "");
}

const cleanedPatchWake = stripTranscriptCommands("Patch me in, send this to the current chat.");
assert.equal(cleanedPatchWake.wakeDetected, true);
assert.equal(cleanedPatchWake.text, "send this to the current chat.");

const cleanedStandaloneHey = stripTranscriptCommands("Hey, what am I saying right now?");
assert.equal(cleanedStandaloneHey.wakeDetected, false);
assert.equal(cleanedStandaloneHey.text, "Hey, what am I saying right now?");

const cleanedBoth = stripTranscriptCommands("hey sebastian this is useful that's it");
assert.equal(cleanedBoth.wakeDetected, true);
assert.equal(cleanedBoth.sleepDetected, true);
assert.equal(cleanedBoth.text, "this is useful");

assert.equal(hasTranscriptContent("."), false);
assert.equal(hasTranscriptContent(". . ."), false);
assert.equal(hasTranscriptContent("..."), false);
assert.equal(hasTranscriptContent("pairing is password protected."), true);

console.log("STT WAV and segmentation tests passed");

function silencePcm(ms: number): Buffer {
  return Buffer.alloc(Math.round(16_000 * 2 * ms / 1000));
}

function tonePcm(ms: number): Buffer {
  const samples = Math.round(16_000 * ms / 1000);
  const output = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(Math.sin(i / 8) * 8000);
    output.writeInt16LE(sample, i * 2);
  }
  return output;
}
