/**
 * Script to scan a GitHub repository directory structure of prompts and generate `prompts.json` / `prompts.ts`.
 * 
 * Supported Directory Structure:
 * 
 * repo-root/
 * └── <Category Name>/                   (e.g., "3D Character")
 *     └── <Item Title Folder>/           (e.g., "3D Urban Toy Transformation")
 *             ├── prompt.md
 *             ├── cover.png              (or .jpg / .webp)
 *             ├── variant-1-ref.jpg
 *             ├── variant-1-result.png
 *             ├── variant-2-ref.jpg
 *             └── variant-2-result.png
 */

const fs = require('fs');
const path = require('path');

// GitHub Repo Config (Update these for your repository)
const GITHUB_USER = 'amjadcp';
const GITHUB_REPO = 'sticky-sticker-gallery';
const GITHUB_BRANCH = 'main';

// Set BASE_CDN_URL using jsDelivr CDN
const BASE_CDN_URL = `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}`;

/**
 * Converts a string title into a clean URL-friendly slug
 * e.g. "3D Urban Toy Transformation" -> "3d-urban-toy-transformation"
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

/**
 * Encodes folder and file path segments for safe URLs with spaces
 */
function buildCdnUrl(categoryFolder, itemFolder, fileName) {
  const encCategory = encodeURIComponent(categoryFolder);
  const encItem = encodeURIComponent(itemFolder);
  const encFile = encodeURIComponent(fileName);
  return `${BASE_CDN_URL}/${encCategory}/${encItem}/${encFile}`;
}

/**
 * Parses simple YAML frontmatter from a markdown string
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { metadata: {}, body: content.trim() };
  }

  const yamlRaw = match[1];
  const body = match[2].trim();
  const metadata = {};

  yamlRaw.split('\n').forEach((line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();

      // Clean quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      
      // Parse booleans and numbers
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(val) && val !== '') val = Number(val);
      // Parse array tags (e.g. [clay, 3d])
      else if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      }

      metadata[key] = val;
    }
  });

  return { metadata, body };
}

/**
 * Scans root directory containing Category folders
 */
function generatePrompts(repoRootDir) {
  const prompts = [];
  
  if (!fs.existsSync(repoRootDir)) {
    console.error(`Directory not found: ${repoRootDir}`);
    return [];
  }

  // Folders to ignore if script is run in root
  const ignoreFolders = ['.git', '.github', 'node_modules', 'dist', 'scripts', '.vscode'];

  const categoryDirs = fs.readdirSync(repoRootDir).filter(f => {
    return !ignoreFolders.includes(f) && fs.statSync(path.join(repoRootDir, f)).isDirectory();
  });

  categoryDirs.forEach((categoryFolder) => {
    const categoryPath = path.join(repoRootDir, categoryFolder);
    const itemDirs = fs.readdirSync(categoryPath).filter(f => fs.statSync(path.join(categoryPath, f)).isDirectory());

    itemDirs.forEach((itemFolder) => {
      const itemPath = path.join(categoryPath, itemFolder);
      const promptMdPath = path.join(itemPath, 'prompt.md');

      if (!fs.existsSync(promptMdPath)) {
        console.warn(`Skipping ${categoryFolder}/${itemFolder}: missing prompt.md`);
        return;
      }

      const mdContent = fs.readFileSync(promptMdPath, 'utf-8');
      const { metadata, body: promptText } = parseFrontmatter(mdContent);

      const files = fs.readdirSync(itemPath);

      // 1. Find Cover Image (e.g. cover.png / cover.jpg)
      const coverFile = files.find(f => f.startsWith('cover.') && /\.(jpg|jpeg|png|webp|svg)$/i.test(f));
      const coverImage = coverFile
        ? buildCdnUrl(categoryFolder, itemFolder, coverFile)
        : '';

      // 2. Find Variant Image Pairs (e.g., variant-1-ref.jpg & variant-1-result.png)
      const variantsMap = {};
      files.forEach((f) => {
        const match = f.match(/^variant-(\d+)-(result|ref|reference)\.(jpg|jpeg|png|webp|svg)$/i);
        if (match) {
          const varNum = match[1];
          const type = match[2].toLowerCase().startsWith('ref') ? 'referenceImage' : 'resultImage';
          
          if (!variantsMap[varNum]) {
            variantsMap[varNum] = { id: `var-${varNum}`, label: `Variant ${varNum}` };
          }
          variantsMap[varNum][type] = buildCdnUrl(categoryFolder, itemFolder, f);
        }
      });

      const variants = Object.values(variantsMap).filter(v => v.resultImage && v.referenceImage);
      const referenceImages = variants.map(v => v.resultImage);

      const itemSlug = slugify(itemFolder);

      const promptItem = {
        id: metadata.id || `prompt-${itemSlug}`,
        slug: metadata.slug || itemSlug,
        title: metadata.title || itemFolder,
        category: metadata.category || categoryFolder,
        coverImage: coverImage || (variants[0] ? variants[0].resultImage : ''),
        referenceImages: referenceImages.length > 0 ? referenceImages : [coverImage],
        variants: variants.length > 0 ? variants : undefined,
        promptText: promptText,
        supportedTool: metadata.supportedTool || 'Gemini',
        transformationType: metadata.transformationType || 'Photo Transformation',
        isPremium: metadata.isPremium || false,
        tags: Array.isArray(metadata.tags) ? metadata.tags : [categoryFolder.toLowerCase()],
        published: metadata.published !== false,
        sortOrder: metadata.sortOrder || 99,
        description: metadata.description || '',
        aspectRatio: metadata.aspectRatio || 'portrait',
      };

      prompts.push(promptItem);
    });
  });

  return prompts;
}

// Run script directly if called from CLI (e.g., node script.js)
if (require.main === module) {
  // You can pass a directory argument, or it defaults to the directory where the script is located
  const rootDir = process.argv[2] || __dirname;
  
  console.log(`Scanning for prompts in: ${rootDir}`);
  const prompts = generatePrompts(rootDir);
  
  if (prompts.length > 0) {
    const outPath = path.join(rootDir, 'prompts.json');
    fs.writeFileSync(outPath, JSON.stringify(prompts, null, 2));
    console.log(`✅ Successfully generated ${prompts.length} prompts to ${outPath}`);
  } else {
    console.log('⚠️ No prompts found.');
  }
}

module.exports = { generatePrompts, slugify };
