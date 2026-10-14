// Exercises real HTTP mutations and transactional outbox delivery; only Slack transport is substituted.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { runWorker } from '../../packages/server/modules/integrations/service.mjs';
import {
  observedCreated,
  observedComments,
  observedCreatedLabels,
  observedStatus,
} from './slack-history-corpus.mjs';
import { slackMarkdown } from '../../packages/server/modules/integrations/slack-notifications.mjs';

test('synthetic: Markdown inside code fences remains literal and bounded user mentions stay inert', () => {
  assert.equal(
    slackMarkdown('```md\n## literal\n- **literal**\n```\n<@U123>'),
    '```md\n## literal\n- **literal**\n```\n&lt;@U123&gt;',
  );
});

test('synthetic: non-title HTTP updates name fields for people rather than storage identifiers', async () => {
  const f = await fixture({ SLACK_CHANNEL_ID: 'C123', SLACK_BOT_TOKEN: 'test-token' });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  try {
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
      user_map: {},
    });
    const issue = (await f.create()).data;
    assert.equal(
      (
        await f.request('PATCH', `/api/v1/issues/${issue.id}`, {
          version: 1,
          assignee_id: f.init.user_id,
          start_date: '2026-10-14',
        })
      ).status,
      200,
    );
    const messages = [];
    for (let n = 0; n < 2; n++) {
      await f.db.transaction((tx) =>
        tx.exec(
          "UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE status='lease'",
        ),
      );
      await runWorker(f.db, f.env, {
        fetcher: async (_url, options) => {
          messages.push(JSON.parse(options.body));
          return Response.json({ ok: true, channel: 'C123', ts: '1234567890.123456' });
        },
      });
    }
    const rendered = JSON.stringify(messages.find((message) => message.text.includes('updated')));
    assert(rendered.includes('Assignee, Start date'));
    assert(!rendered.includes('assignee_id'));
    assert(!rendered.includes('start_date'));
  } finally {
    await f.close();
  }
});

test('redacted historical creation renders event-time body and canonical task link', async () => {
  const f = await fixture({ SLACK_CHANNEL_ID: 'C123', SLACK_BOT_TOKEN: 'test-token' });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  try {
    assert.equal(
      (
        await f.request('PATCH', '/api/v1/integrations/slack', {
          team_id: f.init.team_id,
          notify: true,
          user_map: {},
        })
      ).status,
      200,
    );
    const issue = (
      await f.create({ title: 'Historical layout', description: observedCreated.description })
    ).data;
    const calls = [];
    await runWorker(f.db, f.env, {
      fetcher: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return Response.json({ ok: true, channel: 'C123', ts: '1234567890.123456' });
      },
    });
    assert.equal(calls.length, 1);
    const message = calls[0];
    assert.match(message.text, /Owner created an issue/);
    const rendered = JSON.stringify(message.blocks);
    for (const heading of observedCreated.expected.headings) assert(rendered.includes(heading));
    assert(rendered.includes(observedCreated.expected.link));
    assert(rendered.includes(`${f.env.APP_URL}/tasks/${issue.id}`));
    assert(!rendered.includes('"type":"actions"'));
  } finally {
    await f.close();
  }
});

test('redacted historical label overflow and status priority/project presence use independent expectations', async () => {
  const f = await fixture({ SLACK_CHANNEL_ID: 'C123', SLACK_BOT_TOKEN: 'test-token' });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  try {
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
      user_map: {},
    });
    const labels = [];
    for (const name of observedCreatedLabels.labels)
      labels.push((await f.request('POST', '/api/v1/labels', { name, color: '#ffffff' })).data.id);
    const project = (
      await f.request('POST', '/api/v1/projects', {
        name: 'Project Alpha',
        team_ids: [f.init.team_id],
      })
    ).data;
    const messages = [];
    const fetcher = async (_url, options) => {
      messages.push(JSON.parse(options.body));
      return Response.json({ ok: true, channel: 'C123', ts: '1234567890.123456' });
    };
    const drain = async () => {
      await f.db.transaction((tx) =>
        tx.exec(
          "UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE status='lease'",
        ),
      );
      await runWorker(f.db, f.env, { fetcher });
    };
    await f.create({ label_ids: labels });
    await drain();
    assert(JSON.stringify(messages[0].blocks).includes(observedCreatedLabels.expected));
    const team = f.catalog.teams.find((item) => item.id === f.init.team_id);
    const teamLink = `<${f.env.APP_URL}/tasks?team_id=${team.id}|${team.name}>`;
    assert.equal(
      messages[0].blocks[0].text.text,
      `*Owner* created an issue in the ${teamLink} team`,
    );
    for (const observed of observedStatus) {
      const input = {
        priority:
          observed.fields.Priority === 'Medium' ? 3 : observed.fields.Priority === 'High' ? 2 : 0,
        ...(observed.fields.Project ? { project_id: project.id } : {}),
      };
      const issue = (await f.create(input)).data;
      await drain();
      const next =
        f.catalog.statuses.find(
          (status) =>
            status.id !== issue.status_id &&
            status.category === (observed.fields.Priority ? 'completed' : 'started'),
        ) ?? f.catalog.statuses.find((status) => status.id !== issue.status_id);
      await f.request('PATCH', `/api/v1/issues/${issue.id}`, { version: 1, status_id: next.id });
      await drain();
      const message = messages.at(-1);
      assert.match(message.text, /changed issue status to/);
      const marker = observed.fields.Priority ? ':white_check_mark:  ' : '';
      assert.equal(
        message.blocks[0].text.text,
        `${marker}*Owner* changed issue status to *${next.name}* in ${teamLink} team`,
      );
      const rendered = JSON.stringify(message.blocks);
      for (const [name, value] of Object.entries(observed.fields)) {
        assert(rendered.includes(`*${name}*`));
        assert(rendered.includes(value));
      }
      if (!observed.fields.Project) assert(!rendered.includes('*Project*'));
      if (!observed.fields.Priority) assert(!rendered.includes('*Priority*'));
    }
  } finally {
    await f.close();
  }
});

test('redacted historical comments and actual status transition produce distinct immutable cards', async () => {
  const f = await fixture({ SLACK_CHANNEL_ID: 'C123', SLACK_BOT_TOKEN: 'test-token' });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  try {
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
      user_map: {},
    });
    const issue = (await f.create()).data;
    const next = f.catalog.statuses.find((status) => status.id !== issue.status_id);
    assert.equal(
      (await f.request('PATCH', `/api/v1/issues/${issue.id}`, { version: 1, status_id: next.id }))
        .status,
      200,
    );
    for (const observed of observedComments)
      assert.equal(
        (await f.request('POST', `/api/v1/issues/${issue.id}/comments`, { body: observed.body }))
          .status,
        201,
      );
    const jobs = await f.db.transaction((tx) =>
      tx.all(
        "SELECT * FROM outbox WHERE provider='slack' AND status='pending' ORDER BY created_at,id",
      ),
    );
    assert.equal(jobs.length, 5);
    assert.equal(jobs[1].event, 'status');
    const calls = [];
    let time = Date.now();
    for (let index = 0; index < jobs.length; index++) {
      await f.db.transaction((tx) =>
        tx.exec("UPDATE outbox SET next_attempt_at=? WHERE status='lease'", [
          new Date(time - 1000).toISOString(),
        ]),
      );
      await runWorker(f.db, f.env, {
        fetcher: async (_url, options) => {
          calls.push(JSON.parse(options.body));
          return Response.json({ ok: true, channel: 'C123', ts: '1234567890.123456' });
        },
      });
    }
    assert.equal(calls.length, 5);
    assert.match(calls[1].text, /changed issue status to/);
    assert(calls[1].text.includes(next.name));
    for (let index = 0; index < observedComments.length; index++) {
      const message = calls.find(
        (call) => call.blocks[2]?.text?.text === observedComments[index].expected,
      );
      assert(message);
      assert.match(message.text, /commented on/);
      assert.equal(message.blocks[2].text.text, observedComments[index].expected);
      assert.equal(
        message.blocks[0].text.text,
        `*Owner* commented on <${f.env.APP_URL}/tasks/${issue.id}|${issue.key} ${issue.title}>`,
      );
      assert(JSON.stringify(message.blocks).includes('Reply in Tasks'));
      assert(!JSON.stringify(message.blocks).includes('#comment'));
    }
  } finally {
    await f.close();
  }
});
