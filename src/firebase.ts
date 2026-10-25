import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Mandatory initial Firestore connection validation
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) {
        onAuthSuccess(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) {
        onAuthFailure();
      }
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export interface OrderEmailPayload {
  toEmail: string;
  customerName: string;
  orderId: string;
  ticketId: string;
  dateLabel: string;
  slotTime: string;
  packageName: string;
  price: number;
  region: string;
}

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendConfirmationEmailViaGmail(
  accessToken: string,
  payload: OrderEmailPayload
): Promise<{ id: string }> {
  const subject = `Studio 04 Confirmation Order ${payload.orderId} & Ticket (${payload.dateLabel})`;
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #F5F3EE; padding: 28px; border-radius: 20px; color: #161513;">
      <div style="font-family: monospace; font-size: 11px; letter-spacing: 2px; color: #6E6A63; text-transform: uppercase;">
        STUDIO 04 · REEL SHOOTS · 212 MERCER LANE, UNIT 4
      </div>
      <h1 style="font-size: 26px; font-weight: 800; margin: 8px 0 16px 0; color: #161513;">
        Your Shoot Slot is Confirmed.
      </h1>
      <p style="font-size: 14px; line-height: 1.6; color: #3D3A35; margin-bottom: 20px;">
        Hi <strong>${payload.customerName}</strong>, your confirmation order and studio entry ticket for <strong>Studio 04</strong> are ready below.
      </p>

      <div style="background: #FFFFFF; border: 1px solid #E5E0D5; border-radius: 16px; padding: 20px; margin-bottom: 16px;">
        <div style="font-family: monospace; font-size: 11px; color: #E04826; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;">
          CONFIRMATION ORDER · ${payload.orderId}
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #6E6A63;">Shoot Date</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700;">${payload.dateLabel}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6E6A63;">Shoot Slot (90 min)</td>
            <td style="padding: 6px 0; text-align: right; font-family: monospace; font-weight: 700;">${payload.slotTime}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6E6A63;">Package</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700;">${payload.packageName} · $${payload.price}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6E6A63;">Booking Region</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${payload.region}</td>
          </tr>
        </table>
      </div>

      <div style="background: #161513; color: #FFFFFF; border-radius: 16px; padding: 20px;">
        <div style="font-family: monospace; font-size: 11px; color: #E04826; letter-spacing: 1.5px;">
          STUDIO ENTRY PASS · CONFIRMED TICKET
        </div>
        <div style="font-family: monospace; font-size: 22px; font-weight: 700; margin: 6px 0;">
          ${payload.ticketId}
        </div>
        <div style="font-size: 12px; color: #A09C94;">
          Present this ticket at Studio 04 (212 Mercer Lane, Unit 4) 10 minutes prior to ${payload.slotTime}.
        </div>
      </div>
    </div>
  `;

  const mimeMessage = [
    `To: ${payload.toEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    htmlBody,
  ].join('\r\n');

  const raw = encodeBase64Url(mimeMessage);

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gmail API error (${response.status}): ${errText}`);
  }

  return response.json();
}
