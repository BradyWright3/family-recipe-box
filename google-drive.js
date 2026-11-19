import { googleClientId } from './google-config.js';

export const driveScope = 'https://www.googleapis.com/auth/drive.readonly';
export const googleConfigured = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(googleClientId);
let sdkLoad;
let authorization;
let session;

export function googleReady() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!sdkLoad) {
    sdkLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => globalThis.google?.accounts?.oauth2
        ? resolve() : reject(new Error('Google sign-in did not load.'));
      script.onerror = () => reject(new Error('Google sign-in did not load. Check your connection and try again.'));
      document.head.append(script);
    }).catch(error => {
      sdkLoad = undefined;
      throw error;
    });
  }
  return sdkLoad;
}

export function googleConnected() {
  return Boolean(session && session.expiresAt > Date.now() + 15000);
}

export function connectGoogle() {
  if (authorization) return authorization;
  const oauth = globalThis.google?.accounts?.oauth2;
  if (!oauth) return Promise.reject(new Error('Google sign-in is still loading.'));
  authorization = new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: googleClientId,
      scope: driveScope,
      include_granted_scopes: false,
      callback(response) {
        if (!response.access_token || !oauth.hasGrantedAllScopes(response, driveScope)) {
          reject(new Error('Allow read access to Google Drive to continue.'));
          return;
        }
        session = {
          token: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in) * 1000
        };
        if (googleConnected()) resolve();
        else reject(new Error('Google returned an expired sign-in. Try again.'));
      },
      error_callback() {
        reject(new Error('Google sign-in did not finish. Allow the pop-up and try again.'));
      }
    });
    client.requestAccessToken({ prompt: 'select_account' });
  }).finally(() => { authorization = undefined; });
  return authorization;
}

export class DrivePlaybackError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function loadDriveVideo(video, signal) {
  if (!googleConnected()) throw new DrivePlaybackError('Sign in to Google again to play this video.', 401);
  const authorized = session;
  const url = new URL('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(video.id));
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');
  const headers = { Authorization: 'Bearer ' + authorized.token };
  if (video.resourceKey) headers['X-Goog-Drive-Resource-Keys'] = video.id + '/' + video.resourceKey;
  const response = await fetch(url, { headers, signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (response.status === 401) {
    if (session === authorized) session = undefined;
    throw new DrivePlaybackError('Your Google sign-in expired. Sign in again to play this video.', 401);
  }
  if (response.status === 403 || response.status === 404) {
    throw new DrivePlaybackError('Google did not allow this file to be downloaded. Check the account, sharing, and download permissions.', response.status);
  }
  if (!response.ok) throw new DrivePlaybackError('Google Drive could not load this video. Try again.', response.status);
  const body = await response.blob();
  if (!body.size || (body.type && !/^(video\/|application\/octet-stream)/i.test(body.type))) {
    throw new Error('Google Drive did not return a playable video file.');
  }
  return body.type.startsWith('video/') ? body : new Blob([body], { type: 'video/mp4' });
}
