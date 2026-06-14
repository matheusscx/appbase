import type { RequestHandler } from 'express';

declare module 'cookie-parser' {
  interface CookieParseOptions {
    decode?: (val: string) => string;
  }
  function cookieParser(
    secret?: string | string[],
    options?: CookieParseOptions,
  ): RequestHandler;
  namespace cookieParser {
    function JSONCookies(obj: Record<string, string>): Record<string, unknown>;
    function JSONCookie(str: string): unknown;
    function signedCookies(
      obj: Record<string, string>,
      secret: string | string[],
    ): Record<string, string>;
    function signedCookie(
      str: string,
      secret: string | string[],
    ): string | false;
  }
  export = cookieParser;
}
