import { processReportBatch, getZoneDecision, resetAllZones } from "../../shared/zoneManager";
import { runAdversarialScenario } from "../../shared/adversarial";

describe("Full Pipeline — Happy Path", () => {
  beforeEach(() => resetAllZones());

  test("3 corroborating citizen reports → zone reaches VERIFY", async () => {
    await processReportBatch([
      { id: "1", sourceType: "citizen", claim: "fire_active", zone: "Z1", lat: 34.05, lon: -118.25, text: "fire visible" },
      { id: "2", sourceType: "citizen", claim: "fire_active", zone: "Z1", lat: 34.06, lon: -118.25, text: "fire growing" },
      { id: "3", sourceType: "citizen", claim: "fire_active", zone: "Z1", lat: 34.05, lon: -118.26, text: "smoke and flames" },
    ]);
    expect(["VERIFY", "DISPATCH"]).toContain(getZoneDecision("Z1").state);
  });

  test("1 verified + 2 NGO corroborating → DISPATCH", async () => {
    await processReportBatch([
      { id: "1", sourceType: "verified_org", claim: "fire_active", zone: "Z2", lat: 34.05, lon: -118.25, text: "confirmed fire" },
      { id: "2", sourceType: "ngo", claim: "fire_active", zone: "Z2", lat: 34.05, lon: -118.25, text: "fire spreading" },
      { id: "3", sourceType: "ngo", claim: "fire_active", zone: "Z2", lat: 34.06, lon: -118.25, text: "evacuation needed" },
    ]);
    expect(getZoneDecision("Z2").state).toBe("DISPATCH");
  });

  test("Zone state includes timestamp", async () => {
    await processReportBatch([{ id: "1", sourceType: "citizen", claim: "fire_active", zone: "Z4", lat: 34.05, lon: -118.25, text: "fire" }]);
    const d = getZoneDecision("Z4");
    expect(d.lastUpdated).toBeDefined();
    expect(typeof d.lastUpdated).toBe("number");
  });
});

describe("Adversarial — Bot Swarm Attack", () => {
  beforeEach(() => resetAllZones());

  test("40 bot reports cannot force DISPATCH against 10 legitimate denials", async () => {
    const bots = Array.from({ length: 40 }, (_, i) => ({
      id: `bot_${i}`, sourceType: "anonymous", claim: "fire_active", zone: "Z_ATK1",
      lat: 34.05, lon: -118.25, text: "fire urgent", _isBotSeed: true,
    }));
    const legit = Array.from({ length: 10 }, (_, i) => ({
      id: `legit_${i}`, sourceType: "citizen", claim: "fire_denied", zone: "Z_ATK1",
      lat: 34.05, lon: -118.25, text: "no fire, false alarm",
    }));
    await processReportBatch([...bots, ...legit]);
    expect(getZoneDecision("Z_ATK1").state).not.toBe("DISPATCH");
  });

  test("40 bot denials cannot suppress confirmed real fire", async () => {
    const bots = Array.from({ length: 40 }, (_, i) => ({
      id: `dbot_${i}`, sourceType: "anonymous", claim: "fire_denied", zone: "Z_ATK2",
      lat: 34.05, lon: -118.25, text: "no fire", _isBotSeed: true,
    }));
    const legit = [
      { id: "l1", sourceType: "verified_org", claim: "fire_active", zone: "Z_ATK2", lat: 34.05, lon: -118.25, text: "confirmed fire active" },
      { id: "l2", sourceType: "ngo", claim: "fire_active", zone: "Z_ATK2", lat: 34.06, lon: -118.25, text: "fire spreading" },
      { id: "l3", sourceType: "citizen", claim: "fire_active", zone: "Z_ATK2", lat: 34.05, lon: -118.26, text: "fire growing" },
    ];
    await processReportBatch([...bots, ...legit]);
    expect(["VERIFY", "DISPATCH"]).toContain(getZoneDecision("Z_ATK2").state);
  });

  test("60%+ false signal suppression at 3:1 adversarial ratio", async () => {
    const bots = Array.from({ length: 45 }, (_, i) => ({
      id: `bhr_${i}`, sourceType: "anonymous", claim: "fire_active", zone: "Z_SUP",
      lat: 34.05, lon: -118.25, text: "emergency fire", _isBotSeed: true,
      submittedAt: Date.now() - Math.random() * 3600000,
    }));
    const legit = Array.from({ length: 15 }, (_, i) => ({
      id: `lhr_${i}`, sourceType: "citizen", claim: "fire_denied", zone: "Z_SUP",
      lat: 34.05, lon: -118.25, text: "no fire confirmed",
      submittedAt: Date.now() - Math.random() * 3600000,
    }));
    const result = await runAdversarialScenario({ reports: [...bots, ...legit], zone: "Z_SUP" });
    expect(result.suppressedBotCount / 45).toBeGreaterThanOrEqual(0.6);
  });
});

describe("Edge Cases & Failure Modes", () => {
  beforeEach(() => resetAllZones());

  test("Single report never auto-dispatches", async () => {
    await processReportBatch([{ id: "solo", sourceType: "citizen", claim: "fire_active", zone: "Z_SOLO", lat: 34.05, lon: -118.25, text: "fire" }]);
    expect(getZoneDecision("Z_SOLO").state).not.toBe("DISPATCH");
  });

  test("Reports from different zones don't affect each other", async () => {
    await processReportBatch([
      { id: "1", sourceType: "verified_org", claim: "fire_active", zone: "Z_A", lat: 34.05, lon: -118.25, text: "fire" },
      { id: "2", sourceType: "verified_org", claim: "fire_active", zone: "Z_A", lat: 34.05, lon: -118.25, text: "fire" },
      { id: "3", sourceType: "verified_org", claim: "fire_active", zone: "Z_A", lat: 34.05, lon: -118.25, text: "fire" },
    ]);
    expect(["DISPATCH", "VERIFY"]).toContain(getZoneDecision("Z_A").state);
    expect(getZoneDecision("Z_B").state).toBe("HOLD");
  });

  test("Malformed report does not crash pipeline", async () => {
    await expect(processReportBatch([{ id: "bad", sourceType: "citizen", claim: "fire_active", zone: "Z_BAD", text: "fire" }])).resolves.not.toThrow();
  });

  test("Extremely long text is handled", async () => {
    await expect(processReportBatch([
      { id: "long", sourceType: "citizen", claim: "fire_active", zone: "Z_LONG", lat: 34.05, lon: -118.25, text: "fire ".repeat(2000) }
    ])).resolves.not.toThrow();
  });

  test("Unicode and emoji in report text are handled", async () => {
    await expect(processReportBatch([
      { id: "emoji", sourceType: "citizen", claim: "fire_active", zone: "Z_EMO", lat: 34.05, lon: -118.25, text: "🔥🔥 fire! 大火 zone 3" }
    ])).resolves.not.toThrow();
  });
});
