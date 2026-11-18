# Hedgefonds-Manager-Duell

Lernspiel zum Thema Hedgefonds. Zwei Fonds verwalten je 100 Mio. € Anlegergeld über mehrere Quartale. Wer am Ende die beste risikobereinigte Rendite (Sharpe-Ratio) erzielt, gewinnt.

## Kommandozeilen-Version

Benötigt nur Node.js (ab Version 16), keine weiteren Pakete.

```bash
node cli/duell.js                         # interaktiv, Modus wird abgefragt
node cli/duell.js --modus pvp --namen Alpha,Beta
node cli/duell.js --modus pvc --runden 12 --seed 2026
npm run demo                              # Computer gegen Computer, zum Zuschauen
```

| Option | Bedeutung |
| --- | --- |
| `--modus pvp\|pvc\|cvc` | Mensch vs. Mensch, Mensch vs. Computer, Computer vs. Computer |
| `--runden N` | Anzahl Quartale (Standard 8, max. 40) |
| `--seed N` | gleiche Zufallszahlen, damit eine ganze Klasse dieselbe Partie spielt |
| `--namen A,B` | Namen der Fonds |
| `--ohne-farbe` | Ausgabe ohne Farben (auch über `NO_COLOR`) |

### Ablauf eines Quartals

1. Eine Schlagzeile erscheint. Sie passt nur in etwa 65 % der Fälle zum tatsächlichen Markt.
2. Jeder Fonds legt fest:
   - **Gewichtung** auf Aktien, Tech-Aktien, Staatsanleihen, Gold und Cash (Summe 100)
   - **Hebel** 1x, 1,5x, 2x oder 3x (Kredit kostet 1,2 % je Quartal)
   - **Put-Absicherung** (kostet 1 % Prämie, begrenzt Aktienverluste auf −6 %)
3. Das Marktszenario wird aufgedeckt (Boom, Seitwärtsmarkt, Zinsanstieg, Inflationsschub, Rezession oder Crash), dazu eine kurze Lektion.
4. Gebühren nach dem Modell „2 und 20“ werden abgezogen. Die Erfolgsprämie fällt nur über der High-Water-Mark an.
5. Fällt ein Fonds unter 50 Mio. €, kommt der **Margin Call** und der Fonds wird geschlossen.

Bei jeder Eingabe zeigt `?` eine Erklärung.

### Lernziele

Diversifikation, Hebelwirkung, Absicherung mit Optionen, Gebührenstrukturen, Volatilität, maximaler Drawdown und Sharpe-Ratio.
