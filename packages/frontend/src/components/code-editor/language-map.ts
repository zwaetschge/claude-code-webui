// Maps file extensions to Monaco language identifiers
const extensionToLanguage: Record<string, string> = {
  // Web
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',

  // Data
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  toml: 'ini',
  csv: 'plaintext',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',

  // Programming
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  clj: 'clojure',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',

  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',

  // Config
  env: 'ini',
  ini: 'ini',
  conf: 'ini',
  config: 'ini',
  properties: 'ini',
  editorconfig: 'ini',

  // Database
  sql: 'sql',
  pgsql: 'pgsql',
  mysql: 'mysql',

  // Misc
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'html',
  svelte: 'html',
  prisma: 'graphql',
};

// Special filename mappings
const filenameToLanguage: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'docker-compose.yml': 'yaml',
  'docker-compose.yaml': 'yaml',
  '.gitignore': 'ini',
  '.env': 'ini',
  '.env.local': 'ini',
  '.env.example': 'ini',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  'tsconfig.json': 'json',
  'package.json': 'json',
};

export function getLanguageFromPath(filePath: string): string {
  const filename = filePath.split('/').pop() || '';
  const lowercaseFilename = filename.toLowerCase();

  // Check for exact filename match
  if (filenameToLanguage[lowercaseFilename]) {
    return filenameToLanguage[lowercaseFilename];
  }

  // Check for extension
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && extensionToLanguage[ext]) {
    return extensionToLanguage[ext];
  }

  return 'plaintext';
}

export { extensionToLanguage, filenameToLanguage };
