import assert from 'node:assert/strict';

import type { SkillLibraryItem } from '@plum-code-webui/shared';
import {
  getDesignPreviewPresentation,
  getDesignPreviewUrl,
} from '../../frontend/src/components/session/designPreviewTemplates.js';

const designMd = {
  name: 'Example',
  tokens: {
    colors: {},
    typography: {},
    rounded: {},
    spacing: {},
    components: {},
    extensions: {},
  },
  sections: [],
  errors: [],
  warnings: [],
};

function designItem(baseName: string): SkillLibraryItem {
  return {
    id: baseName,
    baseName,
    name: baseName,
    description: `${baseName} description`,
    path: `/tmp/${baseName}`,
    enabled: true,
    libraryKind: 'design',
    designMd,
  };
}

function testBuiltInDesignMdPresetsKeepHtmlPreview(): void {
  const item = designItem('design-codex');

  assert.equal(getDesignPreviewUrl(item), '/design-previews/preview-codex.html');
  assert.deepEqual(getDesignPreviewPresentation(item), {
    kind: 'html',
    src: '/design-previews/preview-codex.html',
  });
}

function testPreviewFileOverridesArePreserved(): void {
  assert.equal(
    getDesignPreviewUrl(designItem('design-material-3')),
    '/design-previews/preview-material3.html'
  );
  assert.deepEqual(getDesignPreviewPresentation(designItem('design-ricardo-marketplace')), {
    kind: 'html',
    src: '/design-previews/preview-marketplace.html',
  });
}

function testDesignMdOnlyImportsUseTokenPreview(): void {
  assert.deepEqual(getDesignPreviewPresentation(designItem('design-heritage')), {
    kind: 'tokens',
  });
}

function main(): void {
  testBuiltInDesignMdPresetsKeepHtmlPreview();
  testPreviewFileOverridesArePreserved();
  testDesignMdOnlyImportsUseTokenPreview();
  console.log('style preview regression tests passed');
}

main();
