import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from './admin-permissions';

export const PERMISSION_KEYS = 'admin_permissions';

export const RequirePermissions = (...keys: PermissionKey[]) => SetMetadata(PERMISSION_KEYS, keys);

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSION_KEYS, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const admin = context.switchToHttp().getRequest().user;
    if (!admin || admin.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }

    const raw = admin.adminPermissions;
    let perms: string[] | null = null;
    if (Array.isArray(raw)) perms = raw as string[];
    else if (raw && typeof raw === 'object' && Array.isArray((raw as { permissions?: string[] }).permissions)) {
      perms = (raw as { permissions: string[] }).permissions;
    }

    if (!perms || perms.length === 0) return true;

    const ok = required.some((k) => perms!.includes(k));
    if (!ok) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return true;
  }
}
