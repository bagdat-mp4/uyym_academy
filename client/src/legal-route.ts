export type PageRoute='public'|'account'|'privacy'|'terms';

// Support stable public routes and bookmarks created before their introduction.
export function pageFromLocation(path:string,hash:string):PageRoute{
 if(path==='/privacy')return 'privacy';
 if(path==='/terms')return 'terms';
 if(hash.startsWith('#account'))return 'account';
 if(hash.startsWith('#privacy'))return 'privacy';
 if(hash.startsWith('#terms'))return 'terms';
 return 'public';
}
