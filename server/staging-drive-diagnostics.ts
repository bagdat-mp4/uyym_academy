// Fixed diagnostics only: no URLs, IDs, headers, bodies or error messages.
const operations=['api','owner_api','owner_token','upload_start','upload_sync','upload_chunk','reader_api','reader_file_metadata','reader_folder_metadata','reader_file_acl','reader_folder_acl','reader_media'] as const;
type Operation=typeof operations[number];
const checks:Record<string,string>={
 'Сыртқы қызметтер әлі қосылмаған. Әкімшіге хабарласыңыз':'services_not_ready',
 'Drive upload әлі бапталмаған':'owner_configuration_missing',
 'Drive байланысы қолжетімсіз':'owner_token_failed',
 'Drive иесі қосылмаған':'owner_connection_missing',
 'Drive әрекеті орындалмады':'owner_api_failed',
 'Drive папкасы қосылмаған':'root_folder_missing',
 'Drive upload session жарамсыз':'session_url_rejected',
 'Drive жүктеуін бастау мүмкін болмады':'session_creation_failed',
 'Drive жүктеу сілтемесі жоқ':'session_location_missing',
 'Drive upload range жарамсыз':'range_rejected',
 'Drive upload offset жарамсыз':'offset_rejected',
 'Drive offset жарамсыз':'chunk_offset_rejected',
 'Drive жүктеуі уақытша шектелді':'provider_rate_limited',
 'Drive жүктеу уақытша қолжетімсіз':'session_request_failed',
 'Drive жүктеу сессиясын қайта бастау қажет':'session_rejected',
 'Drive қосылмаған':'reader_token_missing',
 'Приват видео уақытша қолжетімсіз':'reader_api_failed',
};
const providerReasons=new Set(['accessNotConfigured','insufficientFilePermissions','domainPolicy','storageQuotaExceeded','rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','teamDriveFileNotFound','notFound','invalidCredentials','authError','backendError']);
export function safeStagingProviderReason(value:unknown){return typeof value==='string'&&providerReasons.has(value)?value:undefined;}
const routes=new Map([
 ['/api/teacher/video-uploads','upload_list_or_create'],
 ['/api/teacher/video-uploads/:id/sync','upload_sync'],
 ['/api/teacher/video-uploads/:id/chunk','upload_chunk'],
 ['/api/content/lessons/:id','lesson_publish'],
 ['/api/admin/owner-drive','owner_status'],
 ['/api/admin/owner-drive/finish','owner_connect'],
]);
let sink:(line:string)=>void=line=>console.warn(line);
export function setStagingDriveDiagnosticSink(write:(line:string)=>void){sink=write;}
export function stagingDriveDiagnostic(operation:Operation,status?:number,error?:unknown,route?:string,env:NodeJS.ProcessEnv=process.env,write=sink,providerReason?:string){
 if(env.NODE_ENV!=='test'||env.UYYM_UI_DRIVE_STAGING!=='1'||!operations.includes(operation))return;
 const known=error instanceof Error&&Object.hasOwn(checks,error.message)?checks[error.message]:undefined;
 const check=known??(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'request_timeout':error?'unclassified_failure':'provider_response');
 const record={event:'staging_drive_diagnostic',operation,check,...(Number.isInteger(status)&&status!>=100&&status!<=599?{status}:{}),...(route&&routes.has(route)?{route:routes.get(route)}:{}),...(providerReason&&providerReasons.has(providerReason)?{provider_reason:providerReason}:{})};
 try{write(JSON.stringify(record));}catch{/* Diagnostics never change authorization or upload behavior. */}
}
