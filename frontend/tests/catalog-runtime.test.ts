import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

import {
  catalogHash,
  sequenceCatalog,
  stimulusSetVersion
} from "../src/data/sequenceCatalog.generated";
import {
  catalogHash as releaseCatalogHash,
  stimulusSetVersion as releaseStimulusSetVersion
} from "../src/data/releaseInfo";
import {
  assertCatalogReady,
  selectExperimentTrials
} from "../src/data/manifestSelectors";
import { resolveExperimentFormat } from "../src/config/runtimeMode";
import type {
  StimulusFormat,
  StimulusSequence
} from "../src/data/manifestTypes";
import { renderSeriesTable } from "../src/experiment/seriesTableRenderer";

const catalog = sequenceCatalog as readonly StimulusSequence[];

function extractRenderedSeriesRows(
  html: string
): Array<{ period: number; rowHeader: number; value: string }> {
  return [
    ...html.matchAll(
      /<tr data-period="(\d+)">\s*<th scope="row">(\d+)<\/th>\s*<td><span class="series-table-number">(-?\d+\.\d{2})<\/span><\/td>\s*<\/tr>/g
    )
  ].map((match) => ({
    period: Number(match[1]),
    rowHeader: Number(match[2]),
    value: match[3]
  }));
}

test("frozen catalog exposes 272 sequences and 816 unique presentations", () => {
  assertCatalogReady(catalog, stimulusSetVersion, catalogHash);
  assert.equal(catalog.length, 272);
  assert.match(catalogHash, /^[a-f0-9]{64}$/);

  const presentationUids = new Set(
    catalog.flatMap((sequence) =>
      Object.values(sequence.presentations).map(
        (presentation) => presentation.presentation_uid
      )
    )
  );
  assert.equal(presentationUids.size, 816);
  assert.equal(JSON.stringify(catalog).includes('"y21"'), false);
  assert.equal(releaseCatalogHash, catalogHash);
  assert.equal(releaseStimulusSetVersion, stimulusSetVersion);
});

test("Pool 2 fast is keyed by source_id, including the locked ID019 regression", () => {
  const pool2Fast = catalog.filter(
    (sequence) =>
      sequence.pool === "Pool_2" && sequence.variant === "fast"
  );
  assert.equal(pool2Fast.length, 32);
  assert.ok(
    pool2Fast.every(
      (sequence) => sequence.legacy_asset_no === sequence.source_id
    )
  );

  const id019 = pool2Fast.find(
    (sequence) => sequence.sequence_uid === "MMQ-P02-FAST-ID019"
  );
  assert.ok(id019);
  assert.deepEqual(
    {
      source_id: id019.source_id,
      display_index: id019.display_index,
      legacy_asset_no: id019.legacy_asset_no
    },
    {
      source_id: 19,
      display_index: 21,
      legacy_asset_no: 19
    }
  );
  assert.match(
    id019.presentations.graph.legacy_path,
    /Pool2_Graph_fast_19\.png$/
  );
});

test("all generated Video terminal frames exist", () => {
  const terminalPaths = new Set<string>();
  for (const sequence of catalog) {
    const terminalPath = sequence.presentations.video.terminal_frame_path;
    assert.ok(terminalPath, sequence.sequence_uid);
    terminalPaths.add(terminalPath);
    assert.equal(
      existsSync(path.resolve("public", terminalPath)),
      true,
      terminalPath
    );
  }
  assert.equal(terminalPaths.size, 272);
});

test("3,000 randomized five-trial assemblies preserve research constraints", () => {
  const formats: StimulusFormat[] = ["table", "graph", "video"];
  for (const format of formats) {
    for (let iteration = 0; iteration < 1_000; iteration += 1) {
      const trials = selectExperimentTrials(
        catalog,
        format,
        stimulusSetVersion,
        catalogHash
      );
      assert.deepEqual(
        trials.map((trial) => trial.pool),
        ["Pool_1", "Pool_2", "Pool_3", "Pool_4", "Pool_1"]
      );
      assert.deepEqual(
        trials.map((trial) => trial.response_type),
        ["point_only", "point_only", "point_only", "point_only", "point_spd"]
      );
      assert.ok(
        trials.every(
          (trial, index) =>
            trial.trial_no === index + 1 &&
            trial.format === format &&
            trial.catalog_hash === catalogHash
        )
      );
      assert.notEqual(trials[0].sequence_uid, trials[4].sequence_uid);

      for (const trial of trials) {
        if (format === "table") {
          assert.equal(trial.asset_sha256, null);
          assert.equal(
            trial.renderer_version,
            "html-table-v4-unified-dual-panel"
          );
        } else {
          assert.match(trial.asset_sha256 ?? "", /^[a-f0-9]{64}$/);
          assert.equal(trial.renderer_version, null);
        }
      }
    }
  }
});

test("preview format override assembles five matching presentations and never affects formal fallback", () => {
  for (const format of ["table", "video"] as const) {
    const effectiveFormat = resolveExperimentFormat(
      `?preview=1&format=${format}`,
      "graph"
    );
    const trials = selectExperimentTrials(
      catalog,
      effectiveFormat,
      stimulusSetVersion,
      catalogHash
    );

    assert.equal(trials.length, 5);
    assert.ok(trials.every((trial) => trial.format === format));
    assert.ok(
      trials.every((trial) =>
        trial.presentation_uid.includes(`:${format.toUpperCase()}@`)
      )
    );
    if (format === "table") {
      assert.ok(
        trials.every(
          (trial) =>
            trial.asset_sha256 === null &&
            trial.renderer_version === "html-table-v4-unified-dual-panel"
        )
      );
    } else {
      assert.ok(
        trials.every(
          (trial) =>
            trial.legacy_path.endsWith(".gif") &&
            /^[a-f0-9]{64}$/.test(trial.asset_sha256 ?? "")
        )
      );
    }
  }

  assert.equal(resolveExperimentFormat("?format=table", "graph"), "table");
  assert.equal(resolveExperimentFormat("", "video"), "video");
});

test("HTML Table renderer outputs two ordered ten-period panels with all 20 values", () => {
  const values = Array.from({ length: 20 }, (_, index) => index + 0.125);
  const html = renderSeriesTable(values);
  const panels = [
    ...html.matchAll(
      /<div\s+class="series-table-panel"\s+data-period-start="(\d+)"\s+data-period-end="(\d+)"\s*>([\s\S]*?)<\/table>\s*<\/div>/g
    )
  ];

  assert.equal((html.match(/<table\b/g) ?? []).length, 2);
  assert.equal((html.match(/<tr/g) ?? []).length, 22);
  assert.equal((html.match(/scope="col"/g) ?? []).length, 4);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 20);
  assert.equal((html.match(/class="series-table-number"/g) ?? []).length, 20);
  assert.equal((html.match(/>时期</g) ?? []).length, 2);
  assert.equal((html.match(/>数值</g) ?? []).length, 2);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="第 1 至第 20 期历史数据"/);
  assert.match(html, /第1–10期/);
  assert.match(html, /第11–20期/);
  assert.equal(panels.length, 2);

  const extractPeriods = (panelHtml: string): number[] =>
    [...panelHtml.matchAll(/<th scope="row">(\d+)<\/th>/g)].map(
      (match) => Number(match[1])
    );
  const extractValues = (panelHtml: string): string[] =>
    [
      ...panelHtml.matchAll(
        /<td><span class="series-table-number">(-?\d+\.\d{2})<\/span><\/td>/g
      )
    ].map(
      (match) => match[1]
    );

  assert.deepEqual(
    panels.map((panel) => [Number(panel[1]), Number(panel[2])]),
    [
      [1, 10],
      [11, 20]
    ]
  );
  assert.deepEqual(extractPeriods(panels[0][3]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(extractPeriods(panels[1][3]), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(
    [...extractValues(panels[0][3]), ...extractValues(panels[1][3])],
    values.map((value) => value.toFixed(2))
  );
  assert.deepEqual(
    extractRenderedSeriesRows(html),
    values.map((value, index) => ({
      period: index + 1,
      rowHeader: index + 1,
      value: value.toFixed(2)
    }))
  );
});

test("HTML Table renderer preserves every catalog period-value pairing", () => {
  for (const sequence of catalog) {
    const rows = extractRenderedSeriesRows(
      renderSeriesTable(sequence.values)
    );
    assert.deepEqual(
      rows,
      sequence.values.map((value, index) => ({
        period: index + 1,
        rowHeader: index + 1,
        value: value.toFixed(2)
      })),
      sequence.sequence_uid
    );
  }
});

test("HTML Table number block fits every frozen catalog value", () => {
  for (const sequence of catalog) {
    sequence.values.forEach((value, index) => {
      const formattedValue = value.toFixed(2);
      assert.ok(
        formattedValue.length <= 7,
        `${sequence.sequence_uid} period ${index + 1} renders as ${formattedValue}, which exceeds the 7ch number block`
      );
    });
  }
});

test("HTML Table renderer rejects incomplete and non-finite sequences", () => {
  assert.throws(
    () => renderSeriesTable(Array.from({ length: 19 }, (_, index) => index)),
    /expected 20 values, found 19/
  );
  assert.throws(
    () => renderSeriesTable(Array.from({ length: 21 }, (_, index) => index)),
    /expected 20 values, found 21/
  );

  const invalidLeft = Array.from({ length: 20 }, (_, index) => index);
  invalidLeft[0] = Number.NaN;
  assert.throws(
    () => renderSeriesTable(invalidLeft),
    /non-finite value/
  );

  const invalidRight = Array.from({ length: 20 }, (_, index) => index);
  invalidRight[19] = Number.POSITIVE_INFINITY;
  assert.throws(
    () => renderSeriesTable(invalidRight),
    /non-finite value/
  );
});

test("trial five exposes accessible distribution inputs and live feedback", () => {
  const html = readFileSync(
    path.resolve("src/experiment/trialRendering.ts"),
    "utf8"
  );

  assert.match(html, /DISTRIBUTION_LABELS/);
  assert.match(
    html,
    /DISTRIBUTION_LABELS\s*\.map\(\(label, index\)/
  );
  assert.match(html, /aria-label="\$\{label\}可能数值"/);
  assert.match(html, /aria-label="\$\{label\}对应概率"/);
  assert.match(html, /name="\$\{probabilityName\}"/);
  assert.match(html, /min="0"/);
  assert.match(html, /max="100"/);
  assert.match(html, /data-probability-total/);
  assert.match(html, /data-support-order/);
});

test("Graph and Video retain frozen asset paths and expose fullscreen controls", () => {
  const source = readFileSync(
    path.resolve("src/experiment/trialRendering.ts"),
    "utf8"
  );

  for (const format of ["graph", "video"] as const) {
    const trial = selectExperimentTrials(
      catalog,
      format,
      stimulusSetVersion,
      catalogHash
    )[0];

    assert.match(trial.legacy_path, /\.(?:png|gif)$/);
    assert.match(trial.asset_sha256 ?? "", /^[a-f0-9]{64}$/);
  }
  assert.match(source, /data-fullscreen-media/);
  assert.match(source, /点击(?:图像|动画)可全屏查看/);
});

test("participant UI has no test banner and no bundled jsPsych stylesheet", () => {
  const experimentSource = readFileSync(
    path.resolve("src/experiment/buildExperiment.ts"),
    "utf8"
  );
  const entrySource = readFileSync(path.resolve("src/main.ts"), "utf8");
  const completionSource = readFileSync(
    path.resolve("src/submission/completion.ts"),
    "utf8"
  );

  assert.doesNotMatch(experimentSource, /test-mode-banner/);
  assert.doesNotMatch(experimentSource, /研究内部测试模式/);
  assert.doesNotMatch(entrySource, /jspsych\/css\/jspsych\.css/);
  assert.match(completionSource, /下载本人作答备份（可选）/);
});

test("release checks reject an incomplete catalog, bad hash, and wrong P2-fast mapping", () => {
  assert.throws(() =>
    assertCatalogReady(
      catalog.slice(0, -1),
      stimulusSetVersion,
      catalogHash
    )
  );
  assert.throws(() =>
    assertCatalogReady(catalog, stimulusSetVersion, "not-a-sha256")
  );

  const targetIndex = catalog.findIndex(
    (sequence) => sequence.sequence_uid === "MMQ-P02-FAST-ID019"
  );
  assert.notEqual(targetIndex, -1);
  const malformed = [...catalog];
  malformed[targetIndex] = {
    ...malformed[targetIndex],
    legacy_asset_no: 21
  };
  assert.throws(() =>
    assertCatalogReady(malformed, stimulusSetVersion, catalogHash)
  );
});
