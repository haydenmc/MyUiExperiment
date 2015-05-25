﻿interface TextBindingInfo {
    elementBindingId: number;
    textNodeIndex: number;
    bindingPath: string;
    bindingText: string;
    updateCallback: (args: ValueChangedEvent<any>) => void;
}

interface PropertyBindingInfo {
    bindingPath: string;
    bindingProperty: string;
    updateCallback: (args: ValueChangedEvent<any>) => void;
}

/**
 * Component is the fundamental base class for any piece of UI that renders to the DOM.
 * It includes implementations for features like data-binding.
 */ 
class Component {
    public static bindingRegex: RegExp = /{{[a-zA-Z._0-9]+}}/g; // Regular expression for bindings
    public static bindingIdCounter: number = 0; // Maintains the next 'unique id' applied to elements tracked for bindings
    public elementId: string; // The unique string that serves as the 'ID' for this Component
    public title: Observable<string> = new Observable<string>(""); // A default observable field
    protected _isShowing: boolean = false;
    public get isShowing(): boolean {
        return this._isShowing;
    }
    protected parentComponent: Component;
    protected rootHtmlElement: HTMLElement; // The root HTML element for this component

    protected propertyBindings: { [bindingPath: string]: Array<PropertyBindingInfo> } = {};
    protected textBindings: { [bindingPath: string]: Array<TextBindingInfo> } = {}; 

    private bindingPathUpdateQueue: Array<string> = new Array<string>(); // Stores binding updates when the element isn't showing

    constructor(id: string, parent?: Component) {
        this.elementId = id;
        this.parentComponent = parent;
        var template: HTMLScriptElement = <HTMLScriptElement>document.getElementById("template_" + this.elementId);
        if (template == null) {
            throw new Error("Tried to instantiate non-existing template");
        }
        // Create root element
        var rootTag = template.getAttribute("data-root-tag");
        this.rootHtmlElement = document.createElement(rootTag);

        // Process property bindings
        // TODO: This should happen when processing new child components
        for (var i = 0; i < template.attributes.length; i++) {
            var attributeName = template.attributes[i].name;
            var attributeValue = template.attributes[i].value;
            if (attributeName.indexOf("data-property-") == 0) {
                var bindingPath = attributeValue.substr(2, attributeValue.length - 4);
                var propertyName = attributeName.substr(14);

                if (typeof this.textBindings[bindingPath] === 'undefined') {
                    this.textBindings[bindingPath] = new Array();
                }
                var bindingInfo: PropertyBindingInfo = {
                    bindingPath: bindingPath,
                    bindingProperty: propertyName,
                    updateCallback: (args: ValueChangedEvent<any>) => {
                        this[propertyName].value = args.newValue;
                    }
                };
                (<Observable<any>>this.parentComponent[bindingPath]).onValueChanged.subscribe(bindingInfo.updateCallback);
                this.propertyBindings[bindingPath].push(bindingInfo);
            }
        }
        var parser = new DOMParser();
        var parsedDocument = parser.parseFromString(template.innerHTML, "text/html");

        for (var i = 0; i < parsedDocument.body.childNodes.length; i++) {
            this.rootHtmlElement.appendChild(parsedDocument.body.childNodes.item(i));
        }

        // Process elements for bindings
        this.processElements(this.rootHtmlElement);
        console.log(this.textBindings);
    }

    private processElements(rootElement: HTMLElement) {
        // Look for bindings in the text nodes
        var textNodes: Array<Node> = [];
        for (var i = 0; i < rootElement.childNodes.length; i++) {
            if (rootElement.childNodes[i].nodeType == 3) { // is a text node
                textNodes.push(rootElement.childNodes[i]);
            }
        }
        
        var bindingId = -1;
        for (var i = 0; i < textNodes.length; i++) {
            var node = textNodes[i];
            var matches = node.nodeValue.match(Component.bindingRegex)
            if (matches != null && matches.length > 0) {
                if (bindingId == -1) {
                    // generate and apply element binding ID
                    bindingId = Component.bindingIdCounter;
                    Component.bindingIdCounter++;
                    rootElement.id = "BindingElement" + bindingId;
                }
                for (var j = 0; j < matches.length; j++) {
                    var path = matches[j].substr(2, matches[j].length - 4);
                    if (typeof this.textBindings[path] === 'undefined') {
                        this.textBindings[path] = new Array();
                    }
                    var bindingInfo: TextBindingInfo = {
                        elementBindingId: bindingId,
                        textNodeIndex: i,
                        bindingPath: path,
                        bindingText: node.nodeValue,
                        updateCallback: (args: ValueChangedEvent<any>) => {
                            this.triggerBindingUpdate(path);
                        }
                    };
                    (<Observable<any>>this[path]).onValueChanged.subscribe(bindingInfo.updateCallback);
                    this.textBindings[path].push(bindingInfo);
                }
                node.nodeValue = this.resolveBindingText(node.nodeValue); // resolve the binding right away
            }
        }

        if (rootElement.hasAttribute("data-component")) {
            this.processSubComponent(rootElement);
        } else {
            // Process bindings for child elements
            for (var i = 0; i < rootElement.childNodes.length; i++) {
                if (rootElement.childNodes[i].nodeType == 1) { // This is an element
                    this.processElements(<HTMLElement>rootElement.childNodes[i]);
                }
            }
        }
    }

    private processSubComponent(element: HTMLElement) {
        var componentId = element.getAttribute("data-component");
        var componentInstance = <Component>Object.create(window[componentId].prototype);
        componentInstance.constructor.apply(componentInstance, new Array(this));
        componentInstance.show(element);
    }

    protected triggerBindingUpdate(path: string) {
        var bindings = this.textBindings[path];
        for (var i = 0; i < bindings.length; i++) {
            var binding = bindings[i];
            var bindingElement = this.rootHtmlElement.querySelector("#BindingElement" + binding.elementBindingId);

            // Look for bindings in the text nodes
            for (var i = 0, textNodeIndex = 0; i < bindingElement.childNodes.length; i++) {
                if (bindingElement.childNodes[i].nodeType == 3) { // is a text node
                    if (textNodeIndex == binding.textNodeIndex) {
                        // Process binding text
                        bindingElement.childNodes[i].nodeValue = this.resolveBindingText(binding.bindingText);
                    }
                    textNodeIndex++;
                }
            }
        }
    }

    private resolveBindingText(text: string): string {
        var matches = text.match(Component.bindingRegex);
        for (var i = 0; i < matches.length; i++) {
            var path = matches[i].substr(2, matches[i].length - 4);
            // TODO: Resolve path with dots...
            text = text.replace(matches[i], this[path].value);
        }
        return text;
    }

    public show(replaceElement?: Element): void {
        if (this._isShowing) {
            return;
        }
        var appendParent = document.body;
        if (this.parentComponent != null) {
            appendParent = this.parentComponent.rootHtmlElement;
        }
        if (typeof replaceElement !== 'undefined') {
            this.rootHtmlElement = <HTMLElement>replaceElement.parentNode.insertBefore(this.rootHtmlElement, replaceElement);
            replaceElement.parentNode.removeChild(replaceElement);
        } else {
            this.rootHtmlElement = <HTMLElement>appendParent.appendChild(this.rootHtmlElement);
        }
        this._isShowing = true;
    }

    public hide(): void {
        if (!this._isShowing) {
            return;
        }

        this.rootHtmlElement = <HTMLElement>this.rootHtmlElement.parentElement.removeChild(this.rootHtmlElement);
        this._isShowing = false;
    }

    public destroy(): void {
        this.hide();
        this.rootHtmlElement = null;
        this.parentComponent = null;

        // TODO: Clear up bindings and such
    }
}