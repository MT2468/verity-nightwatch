# VERITY: Nightwatch

Jogo de terror em primeira pessoa feito do zero para navegador, inspirado na ideia central de **Verity**: uma pequena esfera amarela que começa como assistente amigável e gradualmente se torna algo muito menos confiável.

**Jogar:** https://mt2468.github.io/verity-nightwatch/

## O que foi criado

- Raycaster pseudo-3D próprio em Canvas 2D, sem engine e sem assets externos.
- Mapa original de estação florestal com quatro relés e terminal de saída.
- Verity desenhado proceduralmente, com expressões e comportamento que mudam por fase.
- Progressão de terror em cinco estados, incluindo falas contextuais, interferência visual e perseguição.
- Entidade perseguidora com pathfinding em grade (BFS), em vez de atravessar paredes.
- Lanterna com bateria, corrida com fôlego, colisão, interação e dois finais principais.
- Áudio procedural por Web Audio API, sem arquivos de som copiados.
- Controles de teclado/mouse e controles de toque responsivos.
- Modo de mapa de depuração em `M` para revisão do level design.

## Controles

| Ação | Controle |
| --- | --- |
| Mover | WASD |
| Olhar | Mouse / setas / Q |
| Correr | Shift |
| Interagir | E |
| Lanterna | F |
| Soltar mouse | Esc |
| Mapa de depuração | M |

## Estrutura

```text
index.html      interface e telas
styles.css      HUD, atmosfera e responsividade
src/world.js    mapa, relés, colisão e dados do mundo
src/audio.js    sintetizador procedural
src/game.js     loop, raycaster, IA, interação, render e narrativa
```

## Escopo e autoria

Este é um projeto de fã independente. Não reutiliza texturas, modelos, código, áudio ou outros assets do mod de Minecraft. Os elementos visuais do protótipo são desenhados em tempo real pelo código do jogo.
