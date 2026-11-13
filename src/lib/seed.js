const roleGrants = Object.freeze({
  SUPER_ADMIN: [
    'USER_VIEW', 'USER_CREATE', 'USER_UPDATE_ROLE', 'USER_UPDATE_STATUS', 'USER_DELETE',
    'DASHBOARD_VIEW', 'DASHBOARD_EXPORT',
    'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 'CUSTOMER_EXPORT',
    'BOOKING_VIEW', 'BOOKING_CREATE', 'BOOKING_UPDATE', 'BOOKING_DELETE', 'BOOKING_EXPORT', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'FLEET_CREATE', 'FLEET_UPDATE', 'FLEET_DELETE', 'FLEET_EXPORT', 'FLEET_APPROVE',
    'PRICING_VIEW', 'PRICING_CREATE', 'PRICING_UPDATE', 'PRICING_DELETE', 'PRICING_EXPORT', 'PRICING_APPROVE',
    'ANALYTICS_VIEW', 'ANALYTICS_EXPORT',
    'FINANCE_VIEW', 'FINANCE_CREATE', 'FINANCE_UPDATE', 'FINANCE_DELETE', 'FINANCE_EXPORT', 'FINANCE_APPROVE',
    'MESSAGE_VIEW', 'MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_EXPORT', 'MESSAGE_APPROVE',
    'CONTENT_VIEW', 'CONTENT_CREATE', 'CONTENT_UPDATE', 'CONTENT_DELETE', 'CONTENT_EXPORT', 'CONTENT_APPROVE',
    'SETTINGS_VIEW', 'SETTINGS_CREATE', 'SETTINGS_UPDATE', 'SETTINGS_DELETE', 'SETTINGS_EXPORT', 'SETTINGS_APPROVE',
  ],
  ADMIN: [
    'USER_VIEW',
    'DASHBOARD_VIEW',
    'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 'CUSTOMER_EXPORT',
    'BOOKING_VIEW', 'BOOKING_CREATE', 'BOOKING_UPDATE', 'BOOKING_DELETE', 'BOOKING_EXPORT', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'FLEET_CREATE', 'FLEET_UPDATE', 'FLEET_DELETE', 'FLEET_EXPORT', 'FLEET_APPROVE',
    'PRICING_VIEW', 'PRICING_CREATE', 'PRICING_UPDATE', 'PRICING_DELETE', 'PRICING_EXPORT', 'PRICING_APPROVE',
    'ANALYTICS_VIEW', 'ANALYTICS_EXPORT',
    'FINANCE_VIEW', 'FINANCE_CREATE', 'FINANCE_UPDATE', 'FINANCE_DELETE', 'FINANCE_EXPORT', 'FINANCE_APPROVE',
    'MESSAGE_VIEW', 'MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_EXPORT', 'MESSAGE_APPROVE',
    'CONTENT_VIEW', 'CONTENT_CREATE', 'CONTENT_UPDATE', 'CONTENT_DELETE', 'CONTENT_EXPORT', 'CONTENT_APPROVE',
    'SETTINGS_VIEW', 'SETTINGS_UPDATE',
  ],
  STAFF: [
    'DASHBOARD_VIEW', 'CUSTOMER_VIEW', 'BOOKING_VIEW', 'BOOKING_UPDATE', 'BOOKING_APPROVE',
    'FLEET_VIEW', 'ANALYTICS_VIEW', 'MESSAGE_VIEW', 'MESSAGE_UPDATE', 'CONTENT_VIEW', 'SETTINGS_VIEW', 'SETTINGS_UPDATE',
  ],
});

export async function seedRolesAndPermissions(prisma) {
  if (typeof prisma?.$transaction !== 'function') throw new TypeError('Prisma transaction client is required');
  const permissionCodes = [...new Set(Object.values(roleGrants).flat())];
  return prisma.$transaction(async (tx) => {
    const roles = await Promise.all(Object.keys(roleGrants).map((code) => tx.role.upsert({
      where: { code },
      create: { code },
      update: {},
      select: { id: true, code: true },
    })));
    const permissions = await Promise.all(permissionCodes.map((code) => tx.permission.upsert({
      where: { code },
      create: { code },
      update: {},
      select: { id: true, code: true },
    })));
    const roleIds = Object.fromEntries(roles.map(({ code, id }) => [code, id]));
    const permissionIds = Object.fromEntries(permissions.map(({ code, id }) => [code, id]));
    for (const [roleCode, codes] of Object.entries(roleGrants)) {
      const roleId = roleIds[roleCode];
      const desired = codes.map((code) => ({ roleId, permissionId: permissionIds[code] }));
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: desired });
    }
    return { roles: roleIds, permissions: permissionIds };
  });
}
