import { describe, expect, it } from 'vitest';
import { API_PREFIXES, servesIndex } from './static-client.js';

describe('servesIndex', () => {
  /*
    Le client est une application a page unique : « /profil » n existe pas sur
    le disque, c est le navigateur qui la fabrique. Une requete de navigation
    qui ne correspond a aucun fichier doit donc recevoir `index.html` — sans
    quoi tout rechargement ailleurs que sur la racine, et tout lien
    d invitation partage, rend une page 404.
  */
  it('rend la page pour une navigation inconnue', () => {
    expect(servesIndex('GET', '/')).toBe(true);
    expect(servesIndex('GET', '/profil')).toBe(true);
    expect(servesIndex('GET', '/invite/7K2M')).toBe(true);
    expect(servesIndex('HEAD', '/reglages')).toBe(true);
  });

  /*
    Mais surtout pas pour l API.

    Un `POST /auth/device` mal route recevrait 200 et du HTML la ou le client
    attend du JSON — il afficherait « connexion impossible » sans qu aucune
    trace ne dise pourquoi. Et une route d API absente doit rester un 404 : un
    client qui parle une version plus recente du protocole doit l apprendre,
    pas recevoir la page d accueil.
  */
  it('laisse l API repondre pour elle-meme', () => {
    for (const prefix of API_PREFIXES) {
      expect(servesIndex('GET', prefix)).toBe(false);
      expect(servesIndex('GET', `${prefix}/quoi-que-ce-soit`)).toBe(false);
      expect(servesIndex('POST', `${prefix}/device`)).toBe(false);
    }
  });

  it('couvre les quatre chemins que le serveur expose', () => {
    expect([...API_PREFIXES].sort()).toEqual(['/auth', '/health', '/inventory', '/socket.io']);
  });

  /*
    Une ecriture n est jamais une navigation. Rendre la page sur un POST
    inconnu transformerait une faute de frappe d URL en succes apparent.
  */
  it('ne rend la page que pour une lecture', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(servesIndex(method, '/profil')).toBe(false);
    }
  });

  it('ignore la casse de la methode', () => {
    expect(servesIndex('get', '/profil')).toBe(true);
    expect(servesIndex('head', '/profil')).toBe(true);
  });

  /*
    Un prefixe se compare sur une FRONTIERE de chemin, pas sur les caracteres.

    Sans cela « /authentique » serait pris pour de l API et ne recevrait jamais
    la page — un defaut qui n apparait qu au jour ou une route du client
    commence par les memes lettres qu une route du serveur.
  */
  it('ne confond pas un prefixe avec un simple debut de mot', () => {
    expect(servesIndex('GET', '/authentique')).toBe(true);
    expect(servesIndex('GET', '/healthcheck-maison')).toBe(true);
  });

  /*
    La chaine de requete ne change pas la nature de la requete. Un lien
    d invitation la porte (`/?invite=7K2M`), et une route d API interrogee avec
    des parametres reste une route d API.
  */
  it('regarde le chemin, pas la chaine de requete', () => {
    expect(servesIndex('GET', '/?invite=7K2M')).toBe(true);
    expect(servesIndex('GET', '/health?verbose=1')).toBe(false);
  });

  /*
    Un fichier du build n est pas une navigation : il doit rester un 404 quand
    il manque. Servir `index.html` a la place d un module JavaScript absent
    donnerait au navigateur du HTML pour du JavaScript — une erreur de type
    MIME, illisible, la ou un 404 aurait nomme le fichier manquant.
  */
  it('laisse un fichier absent etre absent', () => {
    for (const path of ['/assets/index-a1b2c3.js', '/favicon.ico', '/assets/style.css']) {
      expect(servesIndex('GET', path)).toBe(false);
    }
  });
});
