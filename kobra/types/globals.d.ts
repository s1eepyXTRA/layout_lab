// Кобра · внешние библиотеки
//
// Единственный файл на TypeScript во всём проекте, и он ничего не исполняет:
// это объявления для проверки типов. ECharts, marked и DOMPurify подключаются
// в <head>, SheetJS и PapaParse — лениво через loadScript(), поэтому в коде
// они просто глобальные имена. Типов у них здесь нет намеренно: тянуть
// @types/* значит заводить npm-зависимости, а их в проекте нет.

declare var echarts: any;
declare var marked: any;
declare var DOMPurify: any;
declare var XLSX: any;
declare var Papa: any;

interface Window {
  echarts: any;
  marked: any;
  DOMPurify: any;
  XLSX: any;
  Papa: any;
}

// Поля, которые Кобра вешает на свои элементы
interface HTMLElement {
  _paint?: () => void;
}
