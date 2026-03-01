import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Image,
  FileVideo,
  FileAudio,
  Database,
  Settings,
  Lock,
  Globe,
  Palette,
  Terminal,
  Package,
  type LucideIcon,
} from 'lucide-react';

interface FileIconConfig {
  icon: LucideIcon;
  color: string;
}

const extensionMap: Record<string, FileIconConfig> = {
  // TypeScript/JavaScript
  ts: { icon: FileCode, color: 'text-blue-500' },
  tsx: { icon: FileCode, color: 'text-blue-500' },
  js: { icon: FileCode, color: 'text-yellow-500' },
  jsx: { icon: FileCode, color: 'text-yellow-500' },
  mjs: { icon: FileCode, color: 'text-yellow-500' },
  cjs: { icon: FileCode, color: 'text-yellow-500' },

  // Web
  html: { icon: Globe, color: 'text-orange-500' },
  htm: { icon: Globe, color: 'text-orange-500' },
  css: { icon: Palette, color: 'text-blue-400' },
  scss: { icon: Palette, color: 'text-pink-500' },
  sass: { icon: Palette, color: 'text-pink-500' },
  less: { icon: Palette, color: 'text-indigo-500' },

  // Data
  json: { icon: FileJson, color: 'text-yellow-600' },
  yaml: { icon: FileJson, color: 'text-red-400' },
  yml: { icon: FileJson, color: 'text-red-400' },
  xml: { icon: FileCode, color: 'text-orange-400' },
  csv: { icon: FileText, color: 'text-green-500' },
  toml: { icon: FileJson, color: 'text-gray-500' },

  // Markdown/Docs
  md: { icon: FileText, color: 'text-gray-400' },
  mdx: { icon: FileText, color: 'text-purple-400' },
  txt: { icon: FileText, color: 'text-gray-400' },
  pdf: { icon: FileText, color: 'text-red-500' },
  doc: { icon: FileText, color: 'text-blue-600' },
  docx: { icon: FileText, color: 'text-blue-600' },

  // Programming Languages
  py: { icon: FileCode, color: 'text-yellow-400' },
  rb: { icon: FileCode, color: 'text-red-500' },
  go: { icon: FileCode, color: 'text-cyan-500' },
  rs: { icon: FileCode, color: 'text-orange-600' },
  java: { icon: FileCode, color: 'text-red-400' },
  kt: { icon: FileCode, color: 'text-purple-500' },
  swift: { icon: FileCode, color: 'text-orange-500' },
  c: { icon: FileCode, color: 'text-blue-600' },
  cpp: { icon: FileCode, color: 'text-blue-500' },
  h: { icon: FileCode, color: 'text-purple-400' },
  hpp: { icon: FileCode, color: 'text-purple-500' },
  cs: { icon: FileCode, color: 'text-green-600' },
  php: { icon: FileCode, color: 'text-indigo-400' },
  lua: { icon: FileCode, color: 'text-blue-400' },
  r: { icon: FileCode, color: 'text-blue-500' },
  scala: { icon: FileCode, color: 'text-red-500' },
  clj: { icon: FileCode, color: 'text-green-500' },
  ex: { icon: FileCode, color: 'text-purple-400' },
  exs: { icon: FileCode, color: 'text-purple-400' },

  // Shell/Scripts
  sh: { icon: Terminal, color: 'text-green-400' },
  bash: { icon: Terminal, color: 'text-green-400' },
  zsh: { icon: Terminal, color: 'text-green-400' },
  fish: { icon: Terminal, color: 'text-green-400' },
  ps1: { icon: Terminal, color: 'text-blue-500' },
  bat: { icon: Terminal, color: 'text-gray-500' },
  cmd: { icon: Terminal, color: 'text-gray-500' },

  // Config
  env: { icon: Settings, color: 'text-yellow-500' },
  ini: { icon: Settings, color: 'text-gray-500' },
  conf: { icon: Settings, color: 'text-gray-500' },
  config: { icon: Settings, color: 'text-gray-500' },

  // Database
  sql: { icon: Database, color: 'text-blue-400' },
  sqlite: { icon: Database, color: 'text-blue-500' },
  db: { icon: Database, color: 'text-gray-500' },

  // Images
  png: { icon: Image, color: 'text-purple-400' },
  jpg: { icon: Image, color: 'text-purple-400' },
  jpeg: { icon: Image, color: 'text-purple-400' },
  gif: { icon: Image, color: 'text-purple-400' },
  svg: { icon: Image, color: 'text-orange-400' },
  webp: { icon: Image, color: 'text-purple-400' },
  ico: { icon: Image, color: 'text-purple-400' },
  bmp: { icon: Image, color: 'text-purple-400' },

  // Video
  mp4: { icon: FileVideo, color: 'text-pink-500' },
  webm: { icon: FileVideo, color: 'text-pink-500' },
  avi: { icon: FileVideo, color: 'text-pink-500' },
  mov: { icon: FileVideo, color: 'text-pink-500' },
  mkv: { icon: FileVideo, color: 'text-pink-500' },

  // Audio
  mp3: { icon: FileAudio, color: 'text-green-400' },
  wav: { icon: FileAudio, color: 'text-green-400' },
  ogg: { icon: FileAudio, color: 'text-green-400' },
  flac: { icon: FileAudio, color: 'text-green-400' },

  // Archives
  zip: { icon: Package, color: 'text-yellow-600' },
  tar: { icon: Package, color: 'text-yellow-600' },
  gz: { icon: Package, color: 'text-yellow-600' },
  rar: { icon: Package, color: 'text-yellow-600' },
  '7z': { icon: Package, color: 'text-yellow-600' },

  // Security
  pem: { icon: Lock, color: 'text-red-400' },
  key: { icon: Lock, color: 'text-red-400' },
  crt: { icon: Lock, color: 'text-red-400' },
  cer: { icon: Lock, color: 'text-red-400' },

  // Font
  ttf: { icon: FileType, color: 'text-gray-500' },
  otf: { icon: FileType, color: 'text-gray-500' },
  woff: { icon: FileType, color: 'text-gray-500' },
  woff2: { icon: FileType, color: 'text-gray-500' },
};

const filenameMap: Record<string, FileIconConfig> = {
  dockerfile: { icon: FileCode, color: 'text-blue-400' },
  'docker-compose.yml': { icon: FileCode, color: 'text-blue-400' },
  'docker-compose.yaml': { icon: FileCode, color: 'text-blue-400' },
  makefile: { icon: Terminal, color: 'text-orange-500' },
  'package.json': { icon: Package, color: 'text-green-500' },
  'package-lock.json': { icon: Package, color: 'text-gray-500' },
  'pnpm-lock.yaml': { icon: Package, color: 'text-orange-400' },
  'yarn.lock': { icon: Package, color: 'text-blue-400' },
  '.gitignore': { icon: Settings, color: 'text-orange-400' },
  '.env': { icon: Lock, color: 'text-yellow-500' },
  '.env.local': { icon: Lock, color: 'text-yellow-500' },
  '.env.example': { icon: Settings, color: 'text-yellow-400' },
  'tsconfig.json': { icon: Settings, color: 'text-blue-500' },
  'vite.config.ts': { icon: Settings, color: 'text-purple-500' },
  'tailwind.config.js': { icon: Settings, color: 'text-cyan-500' },
  'tailwind.config.ts': { icon: Settings, color: 'text-cyan-500' },
  '.eslintrc': { icon: Settings, color: 'text-purple-400' },
  '.eslintrc.js': { icon: Settings, color: 'text-purple-400' },
  '.eslintrc.json': { icon: Settings, color: 'text-purple-400' },
  '.prettierrc': { icon: Settings, color: 'text-pink-400' },
  'readme.md': { icon: FileText, color: 'text-blue-400' },
  'license': { icon: FileText, color: 'text-yellow-500' },
  'license.md': { icon: FileText, color: 'text-yellow-500' },
};

export function getFileIcon(filename: string, isDirectory: boolean, isOpen?: boolean): FileIconConfig {
  if (isDirectory) {
    return {
      icon: isOpen ? FolderOpen : Folder,
      color: 'text-amber-500',
    };
  }

  const lowerFilename = filename.toLowerCase();

  // Check exact filename matches first
  if (filenameMap[lowerFilename]) {
    return filenameMap[lowerFilename];
  }

  // Check extension
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && extensionMap[ext]) {
    return extensionMap[ext];
  }

  // Default file icon
  return { icon: File, color: 'text-gray-400' };
}

export function FileIcon({
  filename,
  isDirectory,
  isOpen,
  className,
}: {
  filename: string;
  isDirectory: boolean;
  isOpen?: boolean;
  className?: string;
}) {
  const { icon: Icon, color } = getFileIcon(filename, isDirectory, isOpen);
  return <Icon className={`${color} ${className || 'h-4 w-4'}`} />;
}
