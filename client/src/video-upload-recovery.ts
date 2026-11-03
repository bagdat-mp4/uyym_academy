export type UploadRecoveryRowStatus='uploading'|'failed'|'cancelled';
export type UploadRecoverySyncStatus='uploading'|'completed'|'failed';
export type UploadRecoveryAction='resume-session'|'completed'|'stop'|'start-new-session';

export function decideUploadRecovery(rowStatus:UploadRecoveryRowStatus,syncStatus?:UploadRecoverySyncStatus):UploadRecoveryAction{
 if(rowStatus!=='uploading')return 'start-new-session';
 if(syncStatus==='completed')return 'completed';
 if(syncStatus==='uploading')return 'resume-session';
 return 'stop';
}
