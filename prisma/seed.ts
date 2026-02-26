import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Rozpoczęcie seedowania bazy danych...');

  // ─── 1. System Roles ──────────────────────────────────
  const roles = [
    { code: 'SA', name: 'Super Admin', description: 'Pełny dostęp systemowy', isSystem: true, permissions: ['*'] },
    { code: 'AT', name: 'Admin Tenanta', description: 'Administrator klienta', isSystem: true, permissions: ['user.manage', 'box.read', 'box.write', 'box.delete', 'box.move', 'box.status', 'folder.read', 'folder.write', 'document.read', 'document.write', 'location.read', 'location.write', 'order.read', 'order.create', 'order.approve', 'order.process', 'order.complete', 'hr.view', 'hr.write', 'hr.view_pesel', 'label.read', 'label.generate', 'label.template_manage', 'attachment.read', 'attachment.upload', 'attachment.delete', 'search.all', 'report.view', 'report.export', 'audit.view', 'retention.manage', 'disposal.initiate', 'disposal.approve', 'import.data', 'export.data', 'inventory.manage', 'transfer_list.read', 'transfer_list.write', 'transfer_list.import'] },
    { code: 'KA', name: 'Koordynator Archiwum', description: 'Koordynator prac archiwistycznych', isSystem: true, permissions: ['box.read', 'box.write', 'box.move', 'box.status', 'folder.read', 'folder.write', 'document.read', 'document.write', 'location.read', 'location.write', 'order.read', 'order.create', 'order.approve', 'order.process', 'order.complete', 'label.read', 'label.generate', 'attachment.read', 'attachment.upload', 'search.all', 'report.view', 'report.export', 'disposal.initiate', 'import.data', 'export.data', 'inventory.manage', 'transfer_list.read', 'transfer_list.write', 'transfer_list.import'] },
    { code: 'OM', name: 'Operator Magazynu', description: 'Pracownik magazynu', isSystem: true, permissions: ['box.read', 'box.write', 'box.move', 'box.status', 'folder.read', 'location.read', 'order.read', 'order.process', 'label.read', 'label.generate', 'search.all', 'inventory.manage'] },
    { code: 'KK', name: 'Koordynator Klienta', description: 'Przedstawiciel klienta', isSystem: true, permissions: ['box.read', 'folder.read', 'document.read', 'order.read', 'order.create', 'attachment.read', 'search.own', 'report.view'] },
    { code: 'HR', name: 'Użytkownik HR', description: 'Dział kadr', isSystem: true, permissions: ['hr.view', 'hr.write', 'hr.view_pesel', 'attachment.read', 'attachment.upload', 'search.own', 'box.read', 'folder.read', 'document.read'] },
    { code: 'AU', name: 'Audytor', description: 'Dostęp do odczytu i raportów', isSystem: true, permissions: ['box.read', 'folder.read', 'document.read', 'order.read', 'hr.view', 'attachment.read', 'search.all', 'report.view', 'report.export', 'audit.view', 'transfer_list.read'] },
    { code: 'RO', name: 'Tylko Odczyt', description: 'Podstawowy dostęp do odczytu', isSystem: true, permissions: ['box.read', 'folder.read', 'document.read', 'attachment.read', 'search.own'] },
  ];

  console.log('  📋 Tworzenie ról systemowych...');
  for (const role of roles) {
    const existing = await prisma.role.findFirst({
      where: { code: role.code, tenantId: null },
    });
    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: { name: role.name, description: role.description, permissions: role.permissions },
      });
    } else {
      await prisma.role.create({
        data: {
          code: role.code,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          permissions: role.permissions,
          tenantId: null,
        },
      });
    }
  }
  console.log(`  ✅ Utworzono ${roles.length} ról`);

  // ─── 2. Demo Tenant ───────────────────────────────────
  console.log('  🏢 Tworzenie tenanta demo...');
  const tenant = await prisma.tenant.upsert({
    where: { shortCode: 'DEMO' },
    update: {},
    create: {
      name: 'Firma Demo Sp. z o.o.',
      shortCode: 'DEMO',
      nip: '1234567890',
      address: 'ul. Archiwalna 1, 00-001 Warszawa',
      contactPerson: 'Jan Kowalski',
      contactEmail: 'kontakt@demo.pl',
      contactPhone: '+48 600 000 000',
      isActive: true,
    },
  });
  console.log(`  ✅ Tenant: ${tenant.name} (${tenant.shortCode})`);

  // ─── 3. Admin User ────────────────────────────────────
  console.log('  👤 Tworzenie użytkownika admin...');
  const passwordHash = await bcrypt.hash('Admin123!@#', 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@archivecore.local' },
    update: {},
    create: {
      email: 'admin@archivecore.local',
      passwordHash,
      firstName: 'Administrator',
      lastName: 'Systemu',
      isActive: true,
      tenantId: null, // SA has no tenant
    },
  });

  // Assign SA role
  const saRole = await prisma.role.findFirst({ where: { code: 'SA', tenantId: null } });
  if (saRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: adminUser.id, roleId: saRole.id } },
      update: {},
      create: { userId: adminUser.id, roleId: saRole.id },
    });
  }
  console.log('  ✅ Admin: admin@archivecore.local / Admin123!@#');

  // Demo tenant admin
  const tenantAdmin = await prisma.user.upsert({
    where: { email: 'admin@demo.pl' },
    update: {},
    create: {
      email: 'admin@demo.pl',
      passwordHash,
      firstName: 'Jan',
      lastName: 'Kowalski',
      isActive: true,
      tenantId: tenant.id,
    },
  });

  const atRole = await prisma.role.findFirst({ where: { code: 'AT', tenantId: null } });
  if (atRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: tenantAdmin.id, roleId: atRole.id } },
      update: {},
      create: { userId: tenantAdmin.id, roleId: atRole.id },
    });
  }
  console.log('  ✅ Tenant Admin: admin@demo.pl / Admin123!@#');

  // ─── 4. Sample Locations ──────────────────────────────
  console.log('  📍 Tworzenie lokalizacji...');
  const warehouse = await prisma.location.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: tenant.id,
      type: 'warehouse',
      code: 'MAG-01',
      name: 'Magazyn Główny',
      description: 'Główny magazyn archiwum',
      fullPath: 'MAG-01',
      capacity: 1000,
      sortOrder: 1,
    },
  });

  const zone = await prisma.location.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      tenantId: tenant.id,
      parentId: warehouse.id,
      type: 'zone',
      code: 'S-A',
      name: 'Strefa A',
      fullPath: 'MAG-01 / S-A',
      capacity: 500,
      sortOrder: 1,
    },
  });

  const racks = [];
  for (let r = 1; r <= 3; r++) {
    const rack = await prisma.location.create({
      data: {
        tenantId: tenant.id,
        parentId: zone.id,
        type: 'rack',
        code: `R-A${r}`,
        name: `Regał A${r}`,
        fullPath: `MAG-01 / S-A / R-A${r}`,
        capacity: 50,
        sortOrder: r,
      },
    });
    racks.push(rack);

    // Create shelves for each rack
    for (let s = 1; s <= 5; s++) {
      await prisma.location.create({
        data: {
          tenantId: tenant.id,
          parentId: rack.id,
          type: 'shelf',
          code: `P-${s}`,
          name: `Półka ${s}`,
          fullPath: `MAG-01 / S-A / R-A${r} / P-${s}`,
          capacity: 10,
          sortOrder: s,
        },
      });
    }
  }
  console.log('  ✅ Utworzono 1 magazyn, 1 strefę, 3 regały, 15 półek');

  // ─── 5. Default Label Template ────────────────────────
  console.log('  🏷️  Tworzenie szablonu etykiet...');
  await prisma.labelTemplate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      tenantId: tenant.id,
      name: 'Domyślny (70×36mm)',
      widthMm: 70,
      heightMm: 36,
      qrSizeMm: 20,
      qrErrorLevel: 'M',
      layoutJson: [
        { key: 'boxNumber', label: 'Nr kartonu', x: 25, y: 2, maxWidth: 43, fontSize: 9, bold: true },
        { key: 'title', label: 'Tytuł', x: 25, y: 12, maxWidth: 43, fontSize: 7 },
        { key: 'tenantName', label: 'Klient', x: 2, y: 24, maxWidth: 35, fontSize: 6 },
        { key: 'location', label: 'Lokalizacja', x: 40, y: 24, maxWidth: 28, fontSize: 6 },
        { key: 'dateRange', label: 'Okres', x: 2, y: 30, maxWidth: 30, fontSize: 6 },
        { key: 'docType', label: 'Typ dok.', x: 35, y: 30, maxWidth: 33, fontSize: 6 },
      ],
      fields: ['boxNumber', 'title', 'tenantName', 'location', 'dateRange', 'docType'],
      isDefault: true,
    },
  });
  console.log('  ✅ Szablon etykiet: 70×36mm');

  // ─── 6. Default Retention Policy ──────────────────────
  console.log('  📅 Tworzenie polityk retencji...');
  await prisma.retentionPolicy.upsert({
    where: { id: '00000000-0000-0000-0000-000000000020' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000020',
      tenantId: tenant.id,
      name: 'Standardowa 10 lat',
      docType: null,
      retentionYears: 10,
      retentionTrigger: 'end_date',
      description: 'Standardowa polityka retencji — 10 lat od daty końcowej dokumentów',
      isActive: true,
    },
  });

  await prisma.retentionPolicy.upsert({
    where: { id: '00000000-0000-0000-0000-000000000021' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000021',
      tenantId: tenant.id,
      name: 'Akta osobowe — nowy okres (10 lat)',
      docType: 'akta_osobowe',
      retentionYears: 10,
      retentionTrigger: 'end_date',
      description: 'Akta osobowe pracowników zatrudnionych po 1.01.2019 — 10 lat od zakończenia stosunku pracy',
      isActive: true,
    },
  });

  await prisma.retentionPolicy.upsert({
    where: { id: '00000000-0000-0000-0000-000000000022' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000022',
      tenantId: tenant.id,
      name: 'Akta osobowe — stary okres (50 lat)',
      docType: 'akta_osobowe',
      retentionYears: 50,
      retentionTrigger: 'end_date',
      description: 'Akta osobowe pracowników zatrudnionych przed 1.01.2019 — 50 lat od zakończenia stosunku pracy',
      isActive: true,
    },
  });
  console.log('  ✅ Utworzono 3 polityki retencji');

  console.log('\n✅ Seedowanie zakończone pomyślnie!');
  console.log('─────────────────────────────────────');
  console.log('Login SA:     admin@archivecore.local / Admin123!@#');
  console.log('Login Demo:   admin@demo.pl / Admin123!@#');
  console.log('Tenant Demo:  DEMO');
  console.log('─────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('❌ Błąd seedowania:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
