import type { CrisisReport, NeedType, Recommendation, ResourcePool, ScoredReport, ZoneCluster } from "./crisis";
import { scoreReport } from "./trust";

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getDominantNeeds(reports: ScoredReport[]): NeedType[] {
  const counts = new Map<NeedType, number>();

  reports.forEach((report) => {
    report.geminiOutput.needs.forEach((need) => {
      counts.set(need, (counts.get(need) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([need]) => need);
}

export function buildZoneClusters(reports: CrisisReport[], now = new Date()): ZoneCluster[] {
  const zoneMap = new Map<string, CrisisReport[]>();

  reports.forEach((report) => {
    const existing = zoneMap.get(report.zone) ?? [];
    existing.push(report);
    zoneMap.set(report.zone, existing);
  });

  return [...zoneMap.entries()].map(([zone, zoneReports]) => {
    const scoredReports = zoneReports.map((report) => scoreReport(report, zoneReports, now));
    const verifiedReports = scoredReports.filter((report) => report.trust.state === "VERIFIED");
    const trustScore = average(scoredReports.map((report) => report.trust.decayedTrust));
    const urgencyScore = average(scoredReports.map((report) => report.geminiOutput.urgency));

    return {
      zone,
      lat: average(scoredReports.map((report) => report.lat)),
      lng: average(scoredReports.map((report) => report.lng)),
      reports: scoredReports,
      verifiedReports,
      trustScore,
      urgencyScore,
      dominantNeeds: getDominantNeeds(scoredReports),
      affectedEstimate: scoredReports.length * 85
    };
  });
}

export function buildRecommendations(
  reports: CrisisReport[],
  resources: ResourcePool,
  now = new Date()
): Recommendation[] {
  const zones = buildZoneClusters(reports, now);
  const recommendations: Recommendation[] = [];
  let rank = 1;

  zones
    .sort((a, b) => b.urgencyScore * b.trustScore - a.urgencyScore * a.trustScore)
    .forEach((zone) => {
      if (zone.trustScore < 0.45) {
        recommendations.push({
          rank: rank++,
          action: "DO NOT DISPATCH",
          zone: zone.zone,
          confidence: Number(zone.trustScore.toFixed(2)),
          rationale: `TrustScore ${zone.trustScore.toFixed(2)} with contradicting or low-reliability reports`,
          flag: "MISINFORMATION_RISK"
        });
        return;
      }

      const topNeed = zone.dominantNeeds[0] ?? "rescue";
      let action = "Monitor situation";

      if (topNeed === "rescue" && resources.rescueBoats > 0) {
        action = `Deploy ${Math.min(2, resources.rescueBoats)} rescue boats`;
      } else if (topNeed === "medical" && resources.medicalTeams > 0) {
        action = `Send ${Math.min(1, resources.medicalTeams)} medical team`;
      } else if (topNeed === "shelter") {
        action = "Open emergency shelter support";
      } else if (topNeed === "food") {
        action = "Route food and relief supplies";
      }

      recommendations.push({
        rank: rank++,
        action,
        zone: zone.zone,
        confidence: Number((zone.urgencyScore * zone.trustScore).toFixed(2)),
        rationale: `urgency ${zone.urgencyScore.toFixed(2)} x trust ${zone.trustScore.toFixed(2)}, ${zone.affectedEstimate} affected`
      });
    });

  return recommendations;
}

