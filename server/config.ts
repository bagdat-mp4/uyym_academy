import 'dotenv/config';
function boundedNumber(value:string|undefined,fallback:number,min:number,max:number){
 const parsed=Number(value);return Number.isFinite(parsed)?Math.min(max,Math.max(min,parsed)):fallback;
}
export const config = {
 port: Number(process.env.PORT || 8787), origin: process.env.APP_ORIGIN || 'http://localhost:5173',
 production: process.env.NODE_ENV === 'production', secure: process.env.COOKIE_SECURE === 'true',
 trustProxy: process.env.TRUST_LOCAL_PROXY === 'true',
 database: process.env.DATABASE_URL || '', supabase: process.env.SUPABASE_URL || '',
 anonKey: process.env.SUPABASE_ANON_KEY || '', serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
 encryptionKey: process.env.ADMIN_ENCRYPTION_KEY || '',
 folders: (process.env.DRIVE_ALLOWED_FOLDER_IDS || '').split(',').filter(Boolean),
 permissionEmails: (process.env.DRIVE_ALLOWED_PERMISSION_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
 contentMaxFileBytes: boundedNumber(process.env.CONTENT_MAX_FILE_BYTES,5242880,1024,5242880),
 contentMaxFiles: boundedNumber(process.env.CONTENT_MAX_FILES,5,1,5)
};
if (config.production && (!config.secure || !config.origin.startsWith('https://'))) throw new Error('Production requires HTTPS and Secure cookies');
export const ready = () => Boolean(config.database && config.supabase && config.anonKey && config.serviceKey && /^[a-f0-9]{64}$/i.test(config.encryptionKey));
export const cookieName = (kind: 'session' | 'ticket') => `${config.secure ? '__Host-' : ''}uyym_${kind}`;
