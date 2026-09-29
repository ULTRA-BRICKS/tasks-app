import { teamSourceFixture } from './linear-import-fixture.mjs';
export function browserHistoryFixture(teamKey) {
  const source = teamSourceFixture(teamKey),
    done = crypto.randomUUID();
  source.data.workflowStates.push({
    ...source.data.workflowStates[0],
    id: done,
    name: 'Done',
    type: 'completed',
  });
  source.data.issueHistory[0].history.nodes = [
    {
      id: crypto.randomUUID(),
      createdAt: '2024-03-01T00:00:00Z',
      actorId: source.ids.user,
      fromStateId: source.ids.state,
      toStateId: done,
    },
    {
      id: crypto.randomUUID(),
      createdAt: '2024-03-02T00:00:00Z',
      actorId: null,
      updatedDescription: true,
    },
    {
      id: crypto.randomUUID(),
      createdAt: '2024-03-03T00:00:00Z',
      actorId: source.ids.user,
      fromTitle: 'Old title',
      toTitle: 'Long title ' + 'readable '.repeat(30),
      fromPriority: 0,
      toPriority: 1,
      addedLabelIds: [source.ids.label],
    },
  ];
  source.manifest.counts = Object.fromEntries(
    Object.entries(source.data).map(([key, rows]) => [key, rows.length]),
  );
  return { source, done };
}
