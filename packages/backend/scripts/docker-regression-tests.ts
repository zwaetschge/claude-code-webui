import assert from 'node:assert/strict';
import {
  DockerHostService,
  type DockerCommandRunner,
} from '../src/services/docker/DockerHostService.ts';

async function testContainerListUsesStableTemplateColumns(): Promise<void> {
  const calls: string[][] = [];
  const runner: DockerCommandRunner = async (args) => {
    calls.push(args);
    assert.equal(
      args.includes('{{json .}}'),
      false,
      'container inventory must not use hanging Docker JSON templates'
    );
    return {
      stdout: [
        [
          '45a4bd94fdb9940dd3870e02701e2d03300e52f260c00da19d6f2dc886ae6218',
          'dnd-web',
          'plum-tabletop/web:latest',
          'Up 37 minutes',
          'running',
          '37 minutes ago',
          '2026-07-01 10:00:00 +0000 UTC',
          '3000/tcp',
          'brian_traefik-public,default',
          '/mnt/user/appdata/dnd-web',
          'com.docker.compose.project=dnd-webui,com.docker.compose.service=web,api_key=secret',
          'npm start',
        ].join('\t'),
        '',
      ].join('\n'),
      stderr: '',
    };
  };

  const service = new DockerHostService({ runner });
  const containers = await service.listContainers();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['ps', '--all', '--no-trunc']);
  assert.equal(containers.length, 1);
  assert.equal(
    containers[0].id,
    '45a4bd94fdb9940dd3870e02701e2d03300e52f260c00da19d6f2dc886ae6218'
  );
  assert.equal(containers[0].shortId, '45a4bd94fdb9');
  assert.equal(containers[0].name, 'dnd-web');
  assert.equal(containers[0].image, 'plum-tabletop/web:latest');
  assert.equal(containers[0].state, 'running');
  assert.equal(containers[0].composeProject, 'dnd-webui');
  assert.equal(containers[0].composeService, 'web');
}

async function main(): Promise<void> {
  await testContainerListUsesStableTemplateColumns();
  console.log('docker regression tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
