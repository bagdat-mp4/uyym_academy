import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {allowedStagingDriveUrl,allowedStagingDriveRedirectUrl,allowedStagingGoogleAuthUrl,STAGING_ROOT_NAME,STAGING_ORIGIN,STAGING_DATABASE_URL,STAGING_SERVICE_ACCOUNT_EMAIL,validateDriveStagingInput,validateStagingServiceAccount} from './drive-staging-config.js';

const serviceAccount=Buffer.from(JSON.stringify({type:'service_account',client_email:STAGING_SERVICE_ACCOUNT_EMAIL,token_uri:'https://oauth2.googleapis.com/token',private_key:'-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'})).toString('base64');
const valid=()=>({enabled:'1',nodeEnv:'test',ownerEmail:'owner@example.test',clientId:'123456-test.apps.googleusercontent.com',clientSecret:'local-secret-only',encryptionKey:'ab'.repeat(32),serviceAccountBase64:serviceAccount});

test('staging accepts only a localhost origin, in-memory database and synthetic Auth configuration',()=>{
 assert.equal(STAGING_ORIGIN,'http://localhost:5174');
 assert.equal(STAGING_DATABASE_URL,'postgresql://unused@127.0.0.1:1/postgres');
 assert.equal(STAGING_ROOT_NAME,'UYYM Academy STAGING - Teacher MP4 Test');
});

test('staging credential input validates OAuth values and base64 service account without logging values',()=>{
 const result=validateDriveStagingInput(valid());
 assert.equal(result.ownerEmail,'owner@example.test');
 assert.equal(result.serviceAccountEmail,STAGING_SERVICE_ACCOUNT_EMAIL);
 for(const update of [
  {enabled:'0'},
  {nodeEnv:'production'},
  {ownerEmail:'not-an-email'},
  {clientId:'production-client'},
  {clientSecret:'bad\nvalue'},
  {encryptionKey:'not-64-hex'},
  {serviceAccountBase64:'not base64'}
 ])assert.throws(()=>validateDriveStagingInput({...valid(),...update}));
});

test('staging credential validation errors never echo submitted secrets',()=>{
 const oauthSecret='oauth-secret-do-not-echo';
 const serviceCredential='service-account-base64-do-not-echo';
 assert.throws(()=>validateDriveStagingInput({...valid(),clientSecret:oauthSecret+'\ninvalid'}),error=>!String(error).includes(oauthSecret));
 assert.throws(()=>validateDriveStagingInput({...valid(),serviceAccountBase64:serviceCredential}),error=>!String(error).includes(serviceCredential));
});

test('key-only import validates and exits before collecting OAuth secrets or starting local processes',async()=>{
 const launcher=await readFile(new URL('../scripts/Start-DriveStaging.ps1',import.meta.url),'utf8');
 const keyOnly=launcher.indexOf('if ($ImportKeyOnly)');
 const ownerPrompt=launcher.indexOf("Read-Host 'Google account email used only for this staging test'");
 const startProcess=launcher.indexOf('Start-IsolatedNode -Arguments');
 assert.match(launcher,/param\(\[switch\]\$ImportKeyOnly\)/);
 assert.ok(keyOnly>=0&&keyOnly<ownerPrompt&&keyOnly<startProcess);
 assert.match(launcher,/uyym-staging-reader@uyym-academy-drive\.iam\.gserviceaccount\.com/);
 assert.equal((launcher.match(/-cne \$expectedServiceAccountEmail/g)||[]).length,2);
});

test('PowerShell 5.1 ACL validation uses direct .NET calls and does not depend on broken Security module autoload',async()=>{
 const launcher=await readFile(new URL('../scripts/Start-DriveStaging.ps1',import.meta.url),'utf8');
 assert.match(launcher,/\.GetAccessControl\(\[Security\.AccessControl\.AccessControlSections\]::Access/);
 assert.doesNotMatch(launcher, /\bGet-Acl\b|\bSet-Acl\b|Import-Module\s+Microsoft\.PowerShell\.Security/);
});

test('PowerShell launcher validates absolute Windows folder paths without unsupported Split-Path parameters',async()=>{
 const launcher=await readFile(new URL('../scripts/Start-DriveStaging.ps1',import.meta.url),'utf8');
 assert.match(launcher,/function Get-ValidatedParentDirectory/);
 assert.match(launcher,/\[IO\.Path\]::GetFullPath\(\$Path\)/);
 assert.match(launcher,/\[IO\.Path\]::GetDirectoryName\(\$fullPath\)/);
 assert.doesNotMatch(launcher,/Split-Path\s+-LiteralPath/);
});

test('PowerShell 5.1 launcher loads System.Security and uses the fully qualified DPAPI type',async()=>{
 const launcher=await readFile(new URL('../scripts/Start-DriveStaging.ps1',import.meta.url),'utf8');
 assert.match(launcher,/Add-Type\s+-AssemblyName\s+System\.Security/);
 assert.equal((launcher.match(/\[System\.Security\.Cryptography\.ProtectedData\]::(?:Protect|Unprotect)/g)||[]).length,2);
 assert.doesNotMatch(launcher,/\[Security\.Cryptography\.ProtectedData\]::/);
});

test('staging Vite disables dotenv files and custom environment exposure while binding only loopback',async()=>{
 const [launcher,viteConfig,fixture]=await Promise.all([
  readFile(new URL('../scripts/Start-DriveStaging.ps1',import.meta.url),'utf8'),
  readFile(new URL('./ui-vite.config.ts',import.meta.url),'utf8'),
  readFile(new URL('./ui-fixture.ts',import.meta.url),'utf8')
 ]);
 assert.match(viteConfig,/envDir:false/);
 assert.match(viteConfig,/envPrefix:\[\]/);
 assert.match(viteConfig,/host:'127\.0\.0\.1',port:5174,strictPort:true/);
 assert.match(viteConfig,/proxy:\{'\/api':'http:\/\/127\.0\.0\.1:18878'\}/);
 assert.doesNotMatch(launcher,/--envDir|viteEnvDir/);
 assert.match(launcher,/info\.EnvironmentVariables\.Clear\(\)/);
 assert.match(launcher,/\$viteEnvironment\s*=\s*@\{NODE_ENV='development'\}/);
 assert.doesNotMatch(launcher,/\$viteEnvironment\s*=\s*@\{[^}]*UYYM_STAGING_/s);
 assert.match(fixture,/DATABASE_URL:STAGING_DATABASE_URL/);
 assert.match(fixture,/SUPABASE_URL:'https:\/\/local-auth\.invalid'/);
 assert.match(fixture,/PORT:'18878'/);
 assert.match(fixture,/app\.listen\(\{host:'127\.0\.0\.1',port:18878\}\)/);
});

test('staging accepts only a Google service-account credential for the approved OAuth token endpoint',()=>{
 const raw=JSON.stringify({type:'service_account',client_email:STAGING_SERVICE_ACCOUNT_EMAIL,token_uri:'https://oauth2.googleapis.com/token',private_key:'-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'});
 assert.equal(validateStagingServiceAccount(raw),STAGING_SERVICE_ACCOUNT_EMAIL);
 assert.throws(()=>validateStagingServiceAccount(JSON.stringify({type:'service_account',client_email:'uyym-drive-reader@uyym-academy-drive.iam.gserviceaccount.com',token_uri:'https://oauth2.googleapis.com/token',private_key:'-----BEGIN PRIVATE KEY-----'})));
 assert.throws(()=>validateStagingServiceAccount(JSON.stringify({type:'service_account',client_email:'reader@other-project.iam.gserviceaccount.com',token_uri:'https://oauth2.googleapis.com/token',private_key:'-----BEGIN PRIVATE KEY-----'})));
 assert.throws(()=>validateStagingServiceAccount(JSON.stringify({type:'service_account',client_email:STAGING_SERVICE_ACCOUNT_EMAIL,token_uri:'https://attacker.invalid/token',private_key:'-----BEGIN PRIVATE KEY-----'})));
});

test('staging Drive transport allows only the Google Drive API and resumable upload endpoints',()=>{
 for(const url of ['https://www.googleapis.com/drive/v3/about?fields=storageQuota','https://www.googleapis.com/drive/v3/files','https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable'])assert.equal(allowedStagingDriveUrl(url),true);
 for(const url of ['http://www.googleapis.com/drive/v3/files','https://drive.google.com/drive/v3/files','https://www.googleapis.com/oauth2/v2/userinfo','https://www.googleapis.com/upload/drive/v3/files?x=1#fragment','https://user:pass@www.googleapis.com/drive/v3/files','not-a-url'])assert.equal(allowedStagingDriveUrl(url),false);
});

test('staging follows only HTTPS Google Drive download redirects and rejects external redirect targets',()=>{
 for(const url of ['https://www.googleapis.com/download/drive/v3/files/abc/export','https://drive.usercontent.google.com/download?id=abc','https://drive.google.com/uc?id=abc','https://doc-0k-04-docs.googleusercontent.com/content'])assert.equal(allowedStagingDriveRedirectUrl(url),true);
 for(const url of ['https://attacker.invalid/download?id=abc','http://drive.usercontent.google.com/download?id=abc','https://googleusercontent.com.evil.invalid/download','https://drive.google.com/permissions','https://user@drive.google.com/uc','not-a-url'])assert.equal(allowedStagingDriveRedirectUrl(url),false);
});

test('staging Google OAuth transport allows only token POST and certificate GET endpoints',()=>{
 assert.equal(allowedStagingGoogleAuthUrl('https://oauth2.googleapis.com/token','POST'),true);
 for(const path of ['/oauth2/v1/certs','/oauth2/v3/certs'])assert.equal(allowedStagingGoogleAuthUrl(`https://www.googleapis.com${path}`,'GET'),true);
 for(const [url,method] of [
  ['https://oauth2.googleapis.com/token','GET'],
  ['https://oauth2.googleapis.com/revoke','POST'],
  ['https://www.googleapis.com/oauth2/v1/certs','POST'],
  ['https://www.googleapis.com/oauth2/v2/userinfo','GET'],
  ['https://attacker.invalid/token','POST'],
  ['http://oauth2.googleapis.com/token','POST']
 ])assert.equal(allowedStagingGoogleAuthUrl(url,method),false);
});
