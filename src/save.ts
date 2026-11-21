import { Capacitor } from '@capacitor/core';

export const ALBUM_NAME = 'VinCam';

export interface Capture {
  id: string;
  kind: 'photo' | 'video';
  blob: Blob;
  url: string;
  ext: string;
  filter: string;
  createdAt: Date;
  saved: boolean;
}

export type SaveResult = 'gallery' | 'shared' | 'downloaded';

export const isNative = () => Capacitor.isNativePlatform();

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isMobile = () => isIOS() || /Android/i.test(navigator.userAgent);

export function fileName(c: Capture) {
  const d = c.createdAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
  return `VinCam_${stamp}_${c.filter}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Writes the capture to the app's cache dir and returns its file:// uri (native only). */
async function writeTemp(c: Capture) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const path = `${fileName(c)}.${c.ext}`;
  const { uri } = await Filesystem.writeFile({
    path,
    data: await blobToBase64(c.blob),
    directory: Directory.Cache,
  });
  return { uri, path, remove: () => Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {}) };
}

let albumId: Promise<string> | null = null;

/** Android requires an album; find or create "VinCam" inside this app's own media folder. */
function androidAlbum(): Promise<string> {
  albumId ??= (async () => {
    const { Media } = await import('@capacitor-community/media');
    const { path } = await Media.getAlbumsPath();
    const find = async () =>
      (await Media.getAlbums()).albums.find((a) => a.name === ALBUM_NAME && a.identifier.startsWith(path));
    let album = await find();
    if (!album) {
      await Media.createAlbum({ name: ALBUM_NAME });
      album = await find();
    }
    if (!album) throw new Error('Could not create the VinCam album.');
    return album.identifier;
  })().catch((e) => {
    albumId = null;
    throw e;
  });
  return albumId;
}

async function saveNative(c: Capture): Promise<SaveResult> {
  const { Media } = await import('@capacitor-community/media');
  const android = Capacitor.getPlatform() === 'android';
  const albumIdentifier = android ? await androidAlbum() : undefined;
  const tmp = await writeTemp(c);
  try {
    const opts = { path: tmp.uri, albumIdentifier, fileName: fileName(c) };
    if (c.kind === 'photo') await Media.savePhoto(opts);
    else await Media.saveVideo(opts);
  } finally {
    await tmp.remove();
  }
  return 'gallery';
}

function download(c: Capture) {
  const a = document.createElement('a');
  a.href = c.url;
  a.download = `${fileName(c)}.${c.ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function asFile(c: Capture) {
  return new File([c.blob], `${fileName(c)}.${c.ext}`, { type: c.blob.type });
}

export function canShare(c: Capture) {
  if (isNative()) return true;
  try {
    return !!navigator.canShare?.({ files: [asFile(c)] });
  } catch {
    return false;
  }
}

/**
 * Save a capture to the device gallery.
 * - Native app (Android/iOS): written straight into the Photos / Gallery app.
 * - iPhone browser: opens the share sheet, where "Save Image" / "Save Video" puts it in Photos.
 * - Other browsers: downloads the file (Android shows Downloads in the gallery).
 */
export async function saveCapture(c: Capture): Promise<SaveResult> {
  if (isNative()) return saveNative(c);
  if (isIOS() && canShare(c)) {
    await navigator.share({ files: [asFile(c)] });
    return 'shared';
  }
  download(c);
  return 'downloaded';
}

export async function shareCapture(c: Capture) {
  if (isNative()) {
    const { Share } = await import('@capacitor/share');
    const tmp = await writeTemp(c);
    await Share.share({ files: [tmp.uri], title: 'VinCam' });
    return;
  }
  await navigator.share({ files: [asFile(c)], title: 'VinCam' });
}

export const saveLabel = () =>
  isNative() || isIOS() ? 'Save to Gallery' : isMobile() ? 'Save to Device' : 'Download';
