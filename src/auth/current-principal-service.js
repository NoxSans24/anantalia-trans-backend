export function createCurrentPrincipalService({ prisma } = {}) {
  if (!prisma) throw new TypeError('Prisma client required');

  async function getPrincipal(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        status: true,
        deletedAt: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null) return null;

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        roles: user.roles.map(({ role }) => role.code),
        permissions: [...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)))].sort(),
      },
    };
  }

  return Object.freeze({ getPrincipal });
}
