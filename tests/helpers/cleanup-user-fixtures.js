export async function cleanupUserFixtures(prisma, userIds) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.activityLog.deleteMany({ where: { OR: [{ actor: { in: ids } }, { targetUserId: { in: ids } }] } });
    await tx.mfaCompletion.deleteMany({ where: { userId: { in: ids } } });
    await tx.mfaChallenge.deleteMany({ where: { userId: { in: ids } } });
    await tx.totpFactor.deleteMany({ where: { userId: { in: ids } } });
    await tx.userRole.deleteMany({ where: { userId: { in: ids } } });
    await (tx.oidcIdentity ?? tx.oIDCIdentity).deleteMany({ where: { userId: { in: ids } } });
    await tx.adminSession.deleteMany({ where: { userId: { in: ids } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
}
