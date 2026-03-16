# SHOPEE TELA

Arquivo principal:
- `clean-version/index.html`

Arquivos de código:
- `clean-version/js/app.js` -> lógica e funcionalidades (carrossel, drawers, carrinho, like, avaliações, bloqueios)
- `clean-version/js/product-data.js` -> dados editáveis do produto
- `clean-version/css/custom.css` -> estilos customizados (banner)

## Como editar produto rapidamente
Edite apenas `clean-version/js/product-data.js`:
- `title`: nome do produto
- `price`: preço principal (ex.: `"55,95"`)
- `images`: lista de URLs das imagens do carrossel
- `rating.average`: média (ex.: `"4.8/5"`)
- `rating.reviewsLabel`: total de avaliações
- `rating.seeAllLabel`: texto do botão de avaliações
- `reviews`: avaliações iniciais (autor, data, texto, útil)

## Banner
- Caminho do banner no HTML: `img/banner.png`
- Arquivo físico: `clean-version/img/banner.png`
