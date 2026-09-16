// Run: node tools/generate-concept-stickman.cjs [--video]
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const sharp = require('sharp');

function resolveFfmpeg() {
  const candidates = [
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    process.env.FFMPEG_PATH,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg'
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'ffmpeg';
}

async function createReelComposite(srcPath, dstPath) {
  const bg = await sharp(srcPath)
    .resize(1080, 1920, { fit: 'cover' })
    .blur(25)
    .modulate({ brightness: 0.45 })
    .toBuffer();

  const fg = await sharp(srcPath)
    .resize(1080, 608, { fit: 'contain' })
    .toBuffer();

  await sharp(bg)
    .composite([{ input: fg, top: Math.round((1920 - 608) / 2), left: 0 }])
    .png()
    .toFile(dstPath);
}

async function main() {
  const outDir = path.resolve(__dirname, '../output/concepts');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('🎨 Processing Google Flow 2D Stickman Concept Assets...');

  const concepts = [
    {
      id: 1,
      name: 'concept_1_problem_state',
      title: 'Concept 1: Problem State',
      source: path.join(outDir, 'ai_concept_1_problem_state.png'),
    },
    {
      id: 2,
      name: 'concept_2_split_screen',
      title: 'Concept 2: Split-Screen Comparison',
      source: path.join(outDir, 'ai_concept_2_split_screen.png'),
    },
    {
      id: 3,
      name: 'concept_3_high_stakes',
      title: 'Concept 3: High-Stakes Dilemma',
      source: path.join(outDir, 'ai_concept_3_high_stakes.png'),
    }
  ];

  for (const c of concepts) {
    if (!fs.existsSync(c.source)) {
      console.warn(`⚠️ Source not found: ${c.source}`);
      continue;
    }

    // 1. Landscape 16:9 (1280x720)
    const landscapePath = path.join(outDir, `${c.name}_landscape.png`);
    await sharp(c.source).resize(1280, 720).png().toFile(landscapePath);
    console.log(`  ✓ Landscape (1280x720): ${path.basename(landscapePath)}`);

    // 2. Reel 9:16 (1080x1920) with blurred ambient backdrop
    const reelPath = path.join(outDir, `${c.name}_reel.png`);
    await createReelComposite(c.source, reelPath);
    console.log(`  ✓ Reel (1080x1920): ${path.basename(reelPath)}`);
  }

  // Generate videos if requested or by default
  const ffmpeg = resolveFfmpeg();
  console.log(`\n🎬 Rendering animated video clips (Google Flow 2D Still-Scene Animation via FFmpeg)...`);

  const demoClips = [];
  for (const c of concepts) {
    const landscapePath = path.join(outDir, `${c.name}_landscape.png`);
    const demoMp4 = path.join(outDir, `${c.name}_demo.mp4`);
    demoClips.push(demoMp4);

    // Zoompan filter: subtle push-in camera effect (Ken Burns)
    const vf = "scale=3840:-1,zoompan=z='min(zoom+0.0012,1.12)':d=120:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=30";
    const cmd = `"${ffmpeg}" -y -loop 1 -i "${landscapePath}" -vf "${vf}" -t 4 -c:v libx264 -pix_fmt yuv420p "${demoMp4}"`;
    try {
      execSync(cmd, { stdio: 'ignore' });
      console.log(`  ✓ Video Demo [4s]: ${path.basename(demoMp4)}`);
    } catch (err) {
      console.error(`  ✕ Error rendering ${demoMp4}:`, err.message);
    }
  }

  // Combined showcase video
  if (demoClips.length === 3) {
    const listFile = path.join(outDir, 'showcase_inputs.txt');
    fs.writeFileSync(listFile, demoClips.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const showcaseMp4 = path.join(outDir, 'concept_google_flow_2d_showcase.mp4');
    const concatCmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${listFile}" -c copy "${showcaseMp4}"`;
    try {
      execSync(concatCmd, { stdio: 'ignore' });
      console.log(`\n🎉 Showcase Full Video [12s]: ${path.basename(showcaseMp4)}`);
      fs.unlinkSync(listFile);
    } catch (err) {
      console.error(`  ✕ Error rendering showcase video:`, err.message);
    }
  }

  console.log(`\n✅ All Google Flow 2D concept images & animated videos generated in: ${outDir}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
