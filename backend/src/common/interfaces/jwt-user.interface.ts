export interface JwtUser {
  id: string;
  email: string;
  tenantId: string | null;
  esSuperadmin: boolean;
}
