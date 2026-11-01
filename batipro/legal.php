<?php
// Pages légales publiques du service : mentions légales, conditions générales, confidentialité, traitement des données (RGPD art. 28).
// Les textes reprennent les coordonnées de la firme qui exploite la plateforme (firme 1) ; le gestionnaire peut les modifier
// dans Plateforme → Documents légaux. Modèles à faire valider par un juriste.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/saas.php';

const LEGAL_DOCS = ['mentions' => 'Mentions légales', 'cgu' => 'Conditions générales d\'utilisation et de vente', 'confidentialite' => 'Politique de confidentialité', 'dpa' => 'Accord de traitement des données (RGPD)'];

function legal_vars(): array {
    $c = setting('company', [], 1) ?: [];
    $cfg = saas_cfg(); $l = setting('legal', [], 1) ?: [];
    return [
        'societe' => (string)($c['name'] ?? 'l\'éditeur'), 'adresse' => trim(((string)($c['street'] ?? '')) . ', ' . trim(($c['zip'] ?? '') . ' ' . ($c['city'] ?? '')), ', '),
        'tva' => (string)($c['vat'] ?? ''), 'bce' => (string)($c['enterprise'] ?? preg_replace('/^BE/i', '', preg_replace('/\s+/', '', (string)($c['vat'] ?? '')))),
        'email' => (string)($c['email'] ?? ''), 'tel' => (string)($c['phone'] ?? ''), 'site' => (string)($c['website'] ?? ''),
        'produit' => (string)($c['appName'] ?? '') ?: 'BâtiPro', 'essai' => (string)(int)$cfg['trialDays'], 'grace' => (string)(int)$cfg['graceDays'],
        'tribunal' => (string)($l['tribunal'] ?? 'Bruxelles'), 'hebergeur' => (string)($l['hebergeur'] ?? 'Hostico (Roumanie, Union européenne)'),
        'version' => SAAS_LEGAL_VERSION, 'date' => (string)($l['date'] ?? '1er octobre 2026'),
    ];
}

function legal_default(string $doc): string {
    switch ($doc) {
        case 'mentions': return <<<'TXT'
## Éditeur du service
{produit} est un service en ligne édité et exploité par **{societe}**, {adresse}.
Numéro d'entreprise (BCE) : {bce} – TVA : {tva}.
Contact : {email} – {tel}.

## Hébergement
Les données du service sont hébergées dans l'Union européenne par {hebergeur}.

## Propriété intellectuelle
Le logiciel {produit}, son code, ses textes, sa présentation et ses logos sont la propriété de {societe}. Toute reproduction sans autorisation écrite est interdite. Les données encodées par les clients restent leur propriété.

## Documents
- Conditions générales d'utilisation et de vente
- Politique de confidentialité
- Accord de traitement des données (RGPD)
TXT;
        case 'cgu': return <<<'TXT'
## 1. Objet
Les présentes conditions régissent l'accès et l'utilisation du service en ligne {produit} (le « Service »), logiciel de gestion pour les entreprises de construction (devis, factures, chantiers, achats, facturation électronique Peppol…), fourni par {societe}, {adresse}, BCE {bce} (le « Prestataire »), à l'entreprise qui crée un compte (le « Client »).
En cochant la case d'acceptation lors de l'inscription, ou en utilisant le Service, le Client accepte ces conditions. Elles prévalent sur ses propres conditions générales.

## 2. Clients professionnels
Le Service est réservé aux entreprises et indépendants agissant dans le cadre de leur activité professionnelle. La personne qui crée le compte déclare avoir le pouvoir d'engager l'entreprise.

## 3. Compte, accès et sécurité
Le Client crée les accès de ses utilisateurs et reste responsable de leur usage. Les identifiants sont personnels et confidentiels. Le Client active la validation en deux étapes pour les comptes administrateurs, choisit des mots de passe solides et prévient le Prestataire sans délai en cas d'utilisation non autorisée.

## 4. Essai gratuit
Un essai gratuit de {essai} jours est proposé à la création du compte, sans moyen de paiement. À la fin de l'essai, l'accès est suspendu tant qu'une formule payante n'est pas choisie ; les données sont conservées comme prévu à l'article 11.

## 5. Formules, prix et paiement
Les formules, leurs limites (nombre d'utilisateurs, modules) et leurs prix sont indiqués dans l'application. Les prix sont exprimés en euros hors TVA ; la TVA est ajoutée selon la loi (autoliquidation pour un client assujetti d'un autre État membre).
L'abonnement est payable d'avance, par mois ou par an, via le prestataire de paiement Mollie (Bancontact, carte, domiciliation SEPA). Il est renouvelé automatiquement à chaque échéance. Une facture est émise à chaque paiement et mise à disposition dans l'application.
En cas d'échec de paiement, le Client dispose de {grace} jours pour régulariser ; à défaut, l'accès est suspendu jusqu'au paiement. Le Prestataire peut modifier ses prix pour l'avenir en prévenant le Client au moins 30 jours avant l'échéance concernée ; le Client peut alors résilier avant cette échéance.

## 6. Durée et résiliation
L'abonnement est conclu pour la période choisie (mois ou année) et se renouvelle tacitement. Le Client peut le résilier à tout moment depuis « Mon abonnement » : plus aucun prélèvement n'a lieu et l'accès reste ouvert jusqu'à la fin de la période déjà payée, sans remboursement de celle-ci.
Le Prestataire peut résilier pour l'avenir moyennant un préavis de 3 mois, ou immédiatement en cas de manquement grave du Client (non-paiement persistant, usage illicite, atteinte à la sécurité du Service).

## 7. Disponibilité et assistance
Le Prestataire met tout en œuvre pour que le Service soit accessible 24 h/24 et 7 j/7 (obligation de moyens). Des interruptions peuvent avoir lieu pour maintenance, si possible annoncées et en dehors des heures de bureau, ou en cas d'incident chez l'hébergeur ou les fournisseurs. Les données sont sauvegardées chaque jour. L'assistance est fournie par e-mail ({email}) les jours ouvrables.

## 8. Obligations du Client
Le Client utilise le Service conformément à la loi. Il reste seul responsable du contenu de ses documents (devis, factures, contrats…), des mentions légales et fiscales qu'ils contiennent, du respect de ses obligations comptables, fiscales et de facturation électronique, et de la conservation légale de ses pièces. Les modèles de documents et de contrats fournis le sont à titre d'aide et doivent être vérifiés par le Client. Il est conseillé d'exporter régulièrement ses données.

## 9. Données personnelles
Pour les données de ses clients, fournisseurs et travailleurs encodées dans le Service, le Client est responsable du traitement et le Prestataire agit comme sous-traitant, selon l'Accord de traitement des données qui fait partie de ces conditions. Pour les données de facturation et de compte du Client, le Prestataire est responsable du traitement selon sa Politique de confidentialité.

## 10. Responsabilité
Le Prestataire est tenu d'une obligation de moyens. Sauf dol, faute intentionnelle ou faute lourde, sa responsabilité est limitée aux dommages directs et prévisibles et, toutes causes confondues, au montant payé par le Client pour le Service au cours des 12 mois précédant le fait générateur. Le Prestataire n'est pas responsable des dommages indirects (perte de chiffre d'affaires, de clientèle, de données imputable au Client), ni des services de tiers (paiement, Peppol, e-mail, intelligence artificielle) ou d'un cas de force majeure.

## 11. Fin du contrat et données
Le Client peut à tout moment exporter toutes ses données (fichier de données et documents) depuis « Mon abonnement ». Après la fin de l'abonnement ou de l'essai, les données restent conservées 90 jours, puis sont supprimées ; elles disparaissent des sauvegardes au plus tard 12 mois après. Sur demande, la suppression intervient plus tôt.

## 12. Propriété intellectuelle
Le Prestataire reste propriétaire du Service. Le Client reçoit un droit d'utilisation personnel, non exclusif et non cessible pendant la durée de l'abonnement. Le Client reste propriétaire de ses données.

## 13. Modification des conditions
Le Prestataire peut adapter ces conditions. Les modifications importantes sont notifiées au moins 30 jours à l'avance ; le Client qui ne les accepte pas peut résilier avant leur entrée en vigueur.

## 14. Droit applicable et litiges
Ces conditions sont soumises au droit belge. Les parties cherchent d'abord une solution amiable. À défaut, les tribunaux de l'arrondissement judiciaire de {tribunal} sont seuls compétents.
TXT;
        case 'confidentialite': return <<<'TXT'
## Qui sommes-nous ?
{societe}, {adresse}, BCE {bce} (« nous »), édite le service {produit}. Contact pour toute question sur vos données : {email}.

## Deux rôles différents
- Pour les **comptes de nos clients** (identité de l'entreprise, utilisateurs, abonnement, paiements, assistance), nous sommes **responsables du traitement** : c'est l'objet de cette politique.
- Pour les **données que nos clients encodent** dans {produit} (leurs clients, fournisseurs, chantiers, travailleurs, documents), nous sommes **sous-traitants** : c'est le client qui décide, selon l'Accord de traitement des données.

## Données que nous traitons
- Identité de l'entreprise : nom, adresse, numéro de TVA, coordonnées.
- Utilisateurs : nom, e-mail, mot de passe (stocké sous forme chiffrée, jamais lisible), rôle, dates de connexion, journal d'activité, adresse IP lors des connexions et de l'acceptation des conditions.
- Abonnement et paiements : formule, factures, identifiants de paiement Mollie (nous ne voyons jamais les numéros de carte).
- Échanges avec l'assistance.

## Pourquoi et sur quelle base
- Fournir le service et gérer l'abonnement : exécution du contrat (art. 6.1.b RGPD).
- Facturer et tenir la comptabilité : obligation légale (art. 6.1.c).
- Sécuriser le service (protection contre les intrusions, journaux, sauvegardes) : intérêt légitime (art. 6.1.f).
- Vous informer sur le service (fin d'essai, paiement, nouveautés importantes) : exécution du contrat et intérêt légitime ; pas de publicité de tiers.

## Durée de conservation
- Compte et données du service : pendant le contrat, puis 90 jours ; sauvegardes : 12 mois au plus.
- Factures et pièces comptables : 7 ans (obligation légale belge).
- Journaux de connexion : 12 mois.

## Destinataires
Nous ne vendons ni ne louons aucune donnée. Seuls nos sous-traitants y accèdent, pour leur mission : hébergement ({hebergeur}), paiement (Mollie B.V., Pays-Bas), e-mail (serveur d'e-mail de l'hébergement), et, si vous les activez : Peppol (Peppyrus, Belgique) et assistant d'intelligence artificielle (Anthropic, États-Unis – clauses contractuelles types de la Commission européenne).
Les données sont hébergées dans l'Union européenne.

## Cookies
{produit} utilise uniquement un cookie de session, strictement nécessaire à la connexion, et le stockage local du navigateur pour vos préférences d'affichage. Aucun cookie publicitaire ni de mesure d'audience : aucun consentement n'est donc requis.

## Vos droits
Vous pouvez demander l'accès, la rectification, l'effacement ou la portabilité de vos données, la limitation du traitement ou vous y opposer, en écrivant à {email}. Nous répondons dans un délai d'un mois. Vous pouvez exporter vous-même toutes les données de votre entreprise depuis « Mon abonnement ».
Vous pouvez introduire une plainte auprès de l'Autorité de protection des données, rue de la Presse 35, 1000 Bruxelles (www.autoriteprotectiondonnees.be).

## Sécurité
Connexion chiffrée (HTTPS), mots de passe chiffrés, validation en deux étapes, blocage des tentatives répétées, séparation stricte des données de chaque entreprise, sauvegardes quotidiennes avec copie hors de l'hébergement. En cas de violation de données à risque, nous prévenons les personnes concernées et l'autorité dans les délais légaux.
TXT;
        case 'dpa': return <<<'TXT'
## 1. Parties et objet
Le présent accord fait partie des conditions générales de {produit}. Il est conclu entre le Client (« responsable du traitement ») et {societe}, {adresse}, BCE {bce} (« sous-traitant »), conformément à l'article 28 du Règlement général sur la protection des données (RGPD).

## 2. Description du traitement
- **Objet** : fourniture du logiciel en ligne {produit} (gestion commerciale, chantiers, facturation, achats, équipes).
- **Durée** : durée de l'abonnement, augmentée de la période de conservation prévue à l'article 9.
- **Nature et finalités** : hébergement, stockage, sauvegarde, affichage et traitement des données encodées par le Client, envoi d'e-mails et de factures électroniques à sa demande.
- **Catégories de personnes** : clients et prospects du Client, fournisseurs et sous-traitants, travailleurs et utilisateurs du Client, intervenants sur les chantiers.
- **Catégories de données** : identité et coordonnées, données de facturation et de paiement, documents et photos de chantier, heures prestées et coût horaire, plannings, rapports. Le Service n'est pas conçu pour des données sensibles (art. 9 RGPD) : le Client s'abstient d'en encoder.

## 3. Instructions
Le sous-traitant traite les données uniquement sur instruction documentée du Client, constituée par ces conditions et l'utilisation du Service. Il informe le Client si une instruction lui paraît contraire au RGPD.

## 4. Confidentialité
Les personnes autorisées à accéder aux données sont soumises à une obligation de confidentialité et n'y accèdent qu'en cas de nécessité (assistance demandée par le Client, maintenance, incident).

## 5. Sécurité (art. 32)
Le sous-traitant met en œuvre notamment : chiffrement des connexions (HTTPS), chiffrement des mots de passe, validation en deux étapes, limitation des tentatives de connexion, séparation logique des données de chaque client, contrôle des accès par rôle, journal d'activité, sauvegardes quotidiennes avec rotation et copie hors de l'hébergement, mises à jour de sécurité.

## 6. Sous-traitants ultérieurs
Le Client autorise le recours aux sous-traitants suivants :
- {hebergeur} – hébergement des serveurs et des sauvegardes, e-mail sortant ;
- Mollie B.V. (Pays-Bas) – paiement de l'abonnement (données de facturation du Client uniquement) ;
- Peppyrus (Belgique) – réseau Peppol, si le Client active la facturation électronique ;
- Anthropic PBC (États-Unis) – assistant d'intelligence artificielle, uniquement si le Client l'active ; transferts encadrés par les clauses contractuelles types de la Commission européenne.
Le sous-traitant informe le Client de tout ajout ou remplacement au moins 30 jours à l'avance ; le Client peut s'y opposer pour un motif raisonnable et, à défaut d'accord, résilier sans frais. Le sous-traitant impose à ses sous-traitants des obligations équivalentes.

## 7. Assistance au Client
Le sous-traitant aide le Client à répondre aux demandes des personnes concernées (le Service permet de consulter, corriger, exporter et supprimer les données), et à respecter ses obligations de sécurité, d'analyse d'impact et de notification.

## 8. Violation de données
Le sous-traitant notifie au Client toute violation de données personnelles dans les meilleurs délais et au plus tard 48 heures après en avoir eu connaissance, avec les informations disponibles pour permettre au Client de notifier l'autorité si nécessaire.

## 9. Fin du traitement
À la fin du contrat, le Client peut exporter toutes ses données. Elles sont ensuite conservées 90 jours puis supprimées ; les sauvegardes sont écrasées au plus tard après 12 mois. Le Client peut demander une suppression anticipée.

## 10. Audit et information
Le sous-traitant met à disposition du Client les informations nécessaires pour démontrer le respect de cet accord et répond à ses questions écrites. Un audit sur place est possible une fois par an, à la charge du Client, moyennant un préavis de 30 jours et un engagement de confidentialité.

## 11. Transferts hors de l'Union européenne
Les données sont hébergées dans l'Union européenne. Aucun transfert n'a lieu en dehors, sauf vers un sous-traitant ultérieur listé à l'article 6 avec des garanties appropriées (clauses contractuelles types).
TXT;
    }
    return '';
}
function legal_text(string $doc): string {
    $over = (setting('legal', [], 1) ?: [])[$doc] ?? '';
    return trim((string)$over) !== '' ? (string)$over : legal_default($doc);
}
// Mise en forme simple : « ## titre », « - liste », **gras**, paragraphes ; {variables} remplacées
function legal_render(string $txt): string {
    $v = legal_vars();
    $txt = preg_replace_callback('/\{(\w+)\}/', fn($m) => $v[$m[1]] ?? $m[0], $txt);
    $e = fn($s) => preg_replace('/\*\*(.+?)\*\*/', '<b>$1</b>', htmlspecialchars($s, ENT_QUOTES, 'UTF-8'));
    $out = ''; $list = false;
    foreach (preg_split('/\r?\n/', $txt) as $line) {
        $t = trim($line);
        if (str_starts_with($t, '- ')) { if (!$list) { $out .= '<ul>'; $list = true; } $out .= '<li>' . $e(substr($t, 2)) . '</li>'; continue; }
        if ($list) { $out .= '</ul>'; $list = false; }
        if ($t === '') continue;
        $out .= str_starts_with($t, '## ') ? '<h2>' . $e(substr($t, 3)) . '</h2>' : '<p>' . $e($t) . '</p>';
    }
    return $out . ($list ? '</ul>' : '');
}

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'legal.php') {
    try { $v = legal_vars(); } catch (Throwable $e) { http_response_code(503); exit('Service indisponible'); }
    $doc = (string)($_GET['doc'] ?? '');
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
    $e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
    $nav = implode(' · ', array_map(fn($k, $l) => $k === $doc ? "<b>{$e($l)}</b>" : "<a href=\"legal.php?doc=$k\">{$e($l)}</a>", array_keys(LEGAL_DOCS), LEGAL_DOCS));
    $body = isset(LEGAL_DOCS[$doc]) ? '<h1>' . $e(LEGAL_DOCS[$doc]) . '</h1><p class="ver">Version ' . $e($v['version']) . ' – en vigueur le ' . $e($v['date']) . '</p>' . legal_render(legal_text($doc))
        : '<h1>Informations légales – ' . $e($v['produit']) . '</h1><ul class="idx">' . implode('', array_map(fn($k, $l) => "<li><a href=\"legal.php?doc=$k\">{$e($l)}</a></li>", array_keys(LEGAL_DOCS), LEGAL_DOCS)) . '</ul>';
    echo '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . $e(LEGAL_DOCS[$doc] ?? 'Informations légales') . ' – ' . $e($v['produit']) . '</title><style>
      body{font:16px/1.65 Helvetica,Arial,sans-serif;color:#1c2550;background:#f4f2ec;margin:0}main{max-width:820px;margin:0 auto;padding:28px 20px 60px}
      nav{font-size:14px;margin-bottom:18px;color:#6b7080}a{color:#1c2550}h1{font-size:28px;line-height:1.25;margin:10px 0 4px}h2{font-size:19px;margin:28px 0 6px}
      .ver{color:#6b7080;font-size:14px;margin-top:0}.box{background:#fff;border-radius:14px;padding:22px 26px;box-shadow:0 2px 12px rgba(0,0,0,.05)}ul{padding-left:22px}.idx li{margin:8px 0;font-size:18px}
      footer{margin-top:20px;font-size:13px;color:#6b7080}</style></head><body><main><nav><a href="./">← ' . $e($v['produit']) . '</a> · ' . $nav . '</nav><div class="box">' . $body . '</div>
      <footer>' . $e($v['societe']) . ' · ' . $e($v['adresse']) . ($v['bce'] ? ' · BCE ' . $e($v['bce']) : '') . ($v['email'] ? ' · ' . $e($v['email']) : '') . '</footer></main></body></html>';
}
