import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../../shared/prisma.service.js';
import { DeviceIdentityConflictError } from '../domain/ports.js';
import { PrismaPlayerRepository } from './prisma-repositories.js';

/**
 * Ce que l'adaptateur **demande** a Prisma, et ce qu'il fait de ce que Prisma
 * lui rend.
 *
 * Un adaptateur n'a qu'un travail : traduire. Deux traductions comptent ici et
 * elles vont par paires — `P2002` devient `DeviceIdentityConflictError`,
 * `P2025` devient `null`, **et tout le reste repart intact**. La seconde moitie
 * est la plus facile a casser sans s'en rendre compte : un `catch` un peu large
 * transforme une panne de base en « cette identite existe deja », et le cas
 * d'usage repart alors chercher un gagnant de course qui n'a jamais existe.
 *
 * Le pendant de ce fichier est `prisma-repositories.integration.test.ts`, qui
 * verifie contre un vrai Postgres que la contrainte d'unicite leve bien
 * `P2002`. Les deux sont necessaires : celui-ci prouve le branchement, l'autre
 * prouve que le code d'erreur traduit est celui que la base produit vraiment.
 */

interface CreateArgs {
  readonly data: {
    readonly displayName: string;
    readonly identities: {
      readonly create: { readonly provider: string; readonly subject: string };
    };
  };
}

interface UpdateArgs {
  readonly where: { readonly id: string };
  readonly data: { readonly displayName?: string };
}

/** Erreur Prisma authentique : c'est la vraie classe que l'adaptateur teste. */
function prismaError(
  code: string,
  meta: Record<string, unknown> = {},
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`echec simule ${code}`, {
    code,
    clientVersion: '7.10.0',
    meta,
  });
}

/**
 * Double de `PrismaService` reduit aux deux appels exerces ici.
 *
 * `failWith` est leve tel quel : c'est precisement l'identite de l'erreur qui
 * nous interesse, pas une copie.
 */
class FakePrisma {
  lastCreate: CreateArgs | null = null;
  lastUpdate: UpdateArgs | null = null;
  failWith: Error | null = null;

  readonly player = {
    create: (args: CreateArgs): Promise<{ id: string; displayName: string }> => {
      this.lastCreate = args;
      return this.failWith === null
        ? Promise.resolve({ id: 'p_1', displayName: args.data.displayName })
        : Promise.reject(this.failWith);
    },
    update: (args: UpdateArgs): Promise<{ id: string; displayName: string }> => {
      this.lastUpdate = args;
      return this.failWith === null
        ? Promise.resolve({ id: args.where.id, displayName: args.data.displayName ?? '' })
        : Promise.reject(this.failWith);
    },
  };

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

function build(): { prisma: FakePrisma; players: PrismaPlayerRepository } {
  const prisma = new FakePrisma();
  return { prisma, players: new PrismaPlayerRepository(prisma.asService()) };
}

const input = { deviceHash: 'h_abcdef', displayName: 'Aura Rouge' };

describe('PrismaPlayerRepository.createWithDeviceIdentity', () => {
  it('demande le joueur et son identite dans une seule ecriture', async () => {
    // Un joueur sans identite serait injoignable, une identite sans joueur
    // serait orpheline : les deux lignes doivent partir ensemble. La creation
    // imbriquee est ce qui rend l'ecriture atomique — deux appels separes ne
    // le seraient pas.
    const { prisma, players } = build();

    await players.createWithDeviceIdentity(input);

    expect(prisma.lastCreate?.data.displayName).toBe('Aura Rouge');
    expect(prisma.lastCreate?.data.identities.create).toEqual({
      provider: 'DEVICE',
      subject: 'h_abcdef',
    });
  });

  it('traduit la violation d unicite P2002 en erreur du domaine', async () => {
    const { prisma, players } = build();
    const cause = prismaError('P2002', { modelName: 'AuthIdentity' });
    prisma.failWith = cause;

    const thrown = await players.createWithDeviceIdentity(input).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DeviceIdentityConflictError);
    expect((thrown as Error).message).toBe('DEVICE_IDENTITY_CONFLICT');
    // La cause d'origine est conservee : sans elle, le diagnostic d'une
    // collision reelle se resumerait a un nom d'erreur.
    expect((thrown as Error).cause).toBe(cause);
  });

  it('laisse repartir intacte une erreur Prisma d un autre code', async () => {
    // P2003 (cle etrangere) n'est pas une course perdue : c'est une anomalie.
    // La traduire en conflit d'identite enverrait le cas d'usage chercher un
    // joueur gagnant qui n'existe pas — et il conclurait a tort a une panne
    // d'adoption plutot qu'a la panne reelle.
    const { prisma, players } = build();
    const cause = prismaError('P2003');
    prisma.failWith = cause;

    await expect(players.createWithDeviceIdentity(input)).rejects.toBe(cause);
  });

  it('laisse repartir intacte une erreur qui ne vient pas de Prisma', async () => {
    const { prisma, players } = build();
    const cause = new Error('base indisponible');
    prisma.failWith = cause;

    await expect(players.createWithDeviceIdentity(input)).rejects.toBe(cause);
  });
});

describe('PrismaPlayerRepository.rename', () => {
  it('rend null quand la ligne visee a disparu (P2025)', async () => {
    const { prisma, players } = build();
    prisma.failWith = prismaError('P2025');

    await expect(players.rename('p_1', 'Aura Bleue')).resolves.toBeNull();
  });

  it('laisse repartir intacte une erreur Prisma d un autre code', async () => {
    const { prisma, players } = build();
    const cause = prismaError('P2002');
    prisma.failWith = cause;

    await expect(players.rename('p_1', 'Aura Bleue')).rejects.toBe(cause);
  });
});
