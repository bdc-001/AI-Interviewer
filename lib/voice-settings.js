import { normalizeVoiceProvider } from "./livekit.js";

export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  provider: "vapi",
  noiseCancellation: {
    enabled: true,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  interruption: {
    enabled: true,
    mode: "adaptive",
    minDurationMs: 500,
    minWords: 0,
    backoffSeconds: 1,
  },
  endpointing: {
    mode: "fixed",
    minDelayMs: 500,
    maxDelayMs: 3000,
  },
  preemptiveGeneration: false,
  aecWarmupMs: 3000,
  vapi: {
    voiceId: "Jess",
    firstMessageInterruptionsEnabled: false,
    waitSeconds: 0.4,
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 1200,
  },
  livekit: {
    sttModel: "assemblyai/universal-3-5-pro",
    ttsModel: "cartesia/sonic-3",
    ttsVoice: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    ttsSpeed: 1.1,
    ttsEmotion: "excited",
  },
});

let override = {};

export function getDefaultVoiceSettings(env = process.env) {
  return normalizeVoiceSettings({
    ...DEFAULT_VOICE_SETTINGS,
    provider: normalizeVoiceProvider(env.VOICE_PROVIDER) || DEFAULT_VOICE_SETTINGS.provider,
    noiseCancellation: {
      ...DEFAULT_VOICE_SETTINGS.noiseCancellation,
      enabled: envBoolean(env.VOICE_NOISE_CANCELLATION, DEFAULT_VOICE_SETTINGS.noiseCancellation.enabled),
      echoCancellation: envBoolean(env.VOICE_ECHO_CANCELLATION, DEFAULT_VOICE_SETTINGS.noiseCancellation.echoCancellation),
      noiseSuppression: envBoolean(env.VOICE_NOISE_SUPPRESSION, DEFAULT_VOICE_SETTINGS.noiseCancellation.noiseSuppression),
      autoGainControl: envBoolean(env.VOICE_AUTO_GAIN_CONTROL, DEFAULT_VOICE_SETTINGS.noiseCancellation.autoGainControl),
    },
    interruption: {
      ...DEFAULT_VOICE_SETTINGS.interruption,
      enabled: envBoolean(env.VOICE_INTERRUPTION_ENABLED, DEFAULT_VOICE_SETTINGS.interruption.enabled),
      mode: envEnum(env.VOICE_INTERRUPTION_MODE, ["adaptive", "vad"], DEFAULT_VOICE_SETTINGS.interruption.mode),
      minDurationMs: envNumber(env.VOICE_INTERRUPTION_MIN_DURATION_MS, DEFAULT_VOICE_SETTINGS.interruption.minDurationMs),
      minWords: envNumber(env.VOICE_INTERRUPTION_MIN_WORDS, DEFAULT_VOICE_SETTINGS.interruption.minWords),
      backoffSeconds: envNumber(env.VOICE_INTERRUPTION_BACKOFF_SECONDS, DEFAULT_VOICE_SETTINGS.interruption.backoffSeconds),
    },
    endpointing: {
      ...DEFAULT_VOICE_SETTINGS.endpointing,
      mode: envEnum(env.VOICE_ENDPOINTING_MODE, ["fixed", "dynamic"], DEFAULT_VOICE_SETTINGS.endpointing.mode),
      minDelayMs: envNumber(env.VOICE_ENDPOINTING_MIN_DELAY_MS, DEFAULT_VOICE_SETTINGS.endpointing.minDelayMs),
      maxDelayMs: envNumber(env.VOICE_ENDPOINTING_MAX_DELAY_MS, DEFAULT_VOICE_SETTINGS.endpointing.maxDelayMs),
    },
    preemptiveGeneration: envBoolean(env.VOICE_PREEMPTIVE_GENERATION, DEFAULT_VOICE_SETTINGS.preemptiveGeneration),
    aecWarmupMs: envNumber(env.VOICE_AEC_WARMUP_MS, DEFAULT_VOICE_SETTINGS.aecWarmupMs),
    vapi: {
      ...DEFAULT_VOICE_SETTINGS.vapi,
      voiceId: envText(env.VAPI_VOICE_ID, DEFAULT_VOICE_SETTINGS.vapi.voiceId),
      firstMessageInterruptionsEnabled: envBoolean(env.VAPI_FIRST_MESSAGE_INTERRUPTIONS, DEFAULT_VOICE_SETTINGS.vapi.firstMessageInterruptionsEnabled),
      waitSeconds: envNumber(env.VAPI_WAIT_SECONDS, DEFAULT_VOICE_SETTINGS.vapi.waitSeconds),
      silenceTimeoutSeconds: envNumber(env.VAPI_SILENCE_TIMEOUT_SECONDS, DEFAULT_VOICE_SETTINGS.vapi.silenceTimeoutSeconds),
      maxDurationSeconds: envNumber(env.VAPI_MAX_DURATION_SECONDS, DEFAULT_VOICE_SETTINGS.vapi.maxDurationSeconds),
    },
    livekit: {
      ...DEFAULT_VOICE_SETTINGS.livekit,
      sttModel: envText(env.LIVEKIT_STT_MODEL, DEFAULT_VOICE_SETTINGS.livekit.sttModel),
      ttsModel: envText(env.LIVEKIT_TTS_MODEL, DEFAULT_VOICE_SETTINGS.livekit.ttsModel),
      ttsVoice: envText(env.LIVEKIT_TTS_VOICE, DEFAULT_VOICE_SETTINGS.livekit.ttsVoice),
      ttsSpeed: envNumber(env.LIVEKIT_TTS_SPEED, DEFAULT_VOICE_SETTINGS.livekit.ttsSpeed),
      ttsEmotion: envText(env.LIVEKIT_TTS_EMOTION, DEFAULT_VOICE_SETTINGS.livekit.ttsEmotion),
    },
  });
}

export function getVoiceSettings(env = process.env) {
  return normalizeVoiceSettings(merge(getDefaultVoiceSettings(env), override));
}

export function setVoiceSettings(input = {}) {
  override = merge(override, sanitizeVoiceSettings(input));
  return getVoiceSettings();
}

export function resetVoiceSettings() {
  override = {};
  return getVoiceSettings();
}

export function publicVoiceSettings(env = process.env) {
  const defaults = getDefaultVoiceSettings(env);
  const settings = getVoiceSettings(env);
  return { settings, defaults };
}

export function normalizeVoiceSettings(input = {}) {
  const source = merge(DEFAULT_VOICE_SETTINGS, input);
  return {
    provider: normalizeVoiceProvider(source.provider) || DEFAULT_VOICE_SETTINGS.provider,
    noiseCancellation: {
      enabled: Boolean(source.noiseCancellation.enabled),
      echoCancellation: Boolean(source.noiseCancellation.echoCancellation),
      noiseSuppression: Boolean(source.noiseCancellation.noiseSuppression),
      autoGainControl: Boolean(source.noiseCancellation.autoGainControl),
    },
    interruption: {
      enabled: Boolean(source.interruption.enabled),
      mode: envEnum(source.interruption.mode, ["adaptive", "vad"], DEFAULT_VOICE_SETTINGS.interruption.mode),
      minDurationMs: clampNumber(source.interruption.minDurationMs, 0, 2000, DEFAULT_VOICE_SETTINGS.interruption.minDurationMs),
      minWords: clampNumber(source.interruption.minWords, 0, 10, DEFAULT_VOICE_SETTINGS.interruption.minWords),
      backoffSeconds: clampNumber(source.interruption.backoffSeconds, 0, 10, DEFAULT_VOICE_SETTINGS.interruption.backoffSeconds),
    },
    endpointing: {
      mode: envEnum(source.endpointing.mode, ["fixed", "dynamic"], DEFAULT_VOICE_SETTINGS.endpointing.mode),
      minDelayMs: clampNumber(source.endpointing.minDelayMs, 0, 5000, DEFAULT_VOICE_SETTINGS.endpointing.minDelayMs),
      maxDelayMs: clampNumber(source.endpointing.maxDelayMs, 100, 10000, DEFAULT_VOICE_SETTINGS.endpointing.maxDelayMs),
    },
    preemptiveGeneration: Boolean(source.preemptiveGeneration),
    aecWarmupMs: clampNumber(source.aecWarmupMs, 0, 10000, DEFAULT_VOICE_SETTINGS.aecWarmupMs),
    vapi: {
      voiceId: clipText(source.vapi.voiceId, 80, DEFAULT_VOICE_SETTINGS.vapi.voiceId),
      firstMessageInterruptionsEnabled: Boolean(source.vapi.firstMessageInterruptionsEnabled),
      waitSeconds: clampNumber(source.vapi.waitSeconds, 0, 5, DEFAULT_VOICE_SETTINGS.vapi.waitSeconds),
      silenceTimeoutSeconds: clampNumber(source.vapi.silenceTimeoutSeconds, 5, 3600, DEFAULT_VOICE_SETTINGS.vapi.silenceTimeoutSeconds),
      maxDurationSeconds: clampNumber(source.vapi.maxDurationSeconds, 10, 43200, DEFAULT_VOICE_SETTINGS.vapi.maxDurationSeconds),
    },
    livekit: {
      sttModel: clipText(source.livekit.sttModel, 120, DEFAULT_VOICE_SETTINGS.livekit.sttModel),
      ttsModel: clipText(source.livekit.ttsModel, 120, DEFAULT_VOICE_SETTINGS.livekit.ttsModel),
      ttsVoice: clipText(source.livekit.ttsVoice, 120, DEFAULT_VOICE_SETTINGS.livekit.ttsVoice),
      ttsSpeed: clampNumber(source.livekit.ttsSpeed, 0.5, 2, DEFAULT_VOICE_SETTINGS.livekit.ttsSpeed),
      ttsEmotion: clipText(source.livekit.ttsEmotion, 40, DEFAULT_VOICE_SETTINGS.livekit.ttsEmotion),
    },
  };
}

function sanitizeVoiceSettings(input) {
  const safe = {};
  if (input.provider !== undefined) safe.provider = input.provider;
  for (const key of ["noiseCancellation", "interruption", "endpointing", "vapi", "livekit"]) {
    if (input[key] && typeof input[key] === "object") safe[key] = { ...input[key] };
  }
  for (const key of ["preemptiveGeneration", "aecWarmupMs"]) {
    if (input[key] !== undefined) safe[key] = input[key];
  }
  return safe;
}

function merge(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base?.[key] && typeof base[key] === "object") {
      result[key] = merge(base[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function envBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function envNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function envText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function envEnum(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clipText(value, max, fallback) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : fallback;
}
