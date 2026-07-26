export const TABLE_RENDERER_VERSION = "html-table-v4-unified-dual-panel";

export function renderSeriesTable(values: readonly number[]): string {
  if (values.length !== 20) {
    throw new Error(
      `HTML table renderer expected 20 values, found ${values.length}.`
    );
  }

  return `
    <div
      class="series-table-grid"
      role="group"
      aria-label="第 1 至第 20 期历史数据"
    >
      ${renderSeriesTablePanel(values.slice(0, 10), 1, 10)}
      ${renderSeriesTablePanel(values.slice(10, 20), 11, 20)}
    </div>
  `;
}

function renderSeriesTablePanel(
  values: readonly number[],
  startPeriod: number,
  endPeriod: number
): string {
  const rangeId = `series-table-range-${startPeriod}-${endPeriod}`;
  const rows = values
    .map(
      (value, index) => `
        <tr data-period="${startPeriod + index}">
          <th scope="row">${startPeriod + index}</th>
          <td><span class="series-table-number">${formatSeriesValue(value)}</span></td>
        </tr>
      `
    )
    .join("");

  return `
    <div
      class="series-table-panel"
      data-period-start="${startPeriod}"
      data-period-end="${endPeriod}"
    >
      <div class="series-table-range" id="${rangeId}">
        第${startPeriod}–${endPeriod}期
      </div>
      <table class="series-table" aria-labelledby="${rangeId}">
        <thead>
          <tr>
            <th scope="col">时期</th>
            <th scope="col">数值</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function formatSeriesValue(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("HTML table renderer received a non-finite value.");
  }
  return value.toFixed(2);
}
