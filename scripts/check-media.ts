import dotenv from 'dotenv';
import { mediaAvailable } from '../src/server/clipMedia';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
if (!await mediaAvailable()) {
  throw new Error('Media tools are unavailable. Install production dependencies with npm ci (including install scripts and optional dependencies), then rebuild.');
}
console.log('Clipping media tools ready: FFmpeg and ffprobe.');
