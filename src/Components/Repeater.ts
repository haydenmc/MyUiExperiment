﻿/// <reference path="Component.ts" />
/// <reference path="../Data/ObservableArray.ts" />

/**
 * The repeater control takes a template, and 'repeats' it with data from
 * the observable array of items provided via data context.
 */
class Repeater extends Component {
    /**
     * The template this repeater uses for each item.
     */
    private template: any;

    /**
     * Used to store a reference to the DOM nodes used to display each list item.
     */
    private itemNodes: Array<Array<Node>>;

    /**
     * Used to store a reference to the data bindings that occur for each list item.
     */
    private itemNodeBindings: Array<Array<NodeDataBindingInformation>>;

    /**
     * Stores the callbacks that should be triggered on item events.
     */
    private itemEventCallbacks: { [eventName: string] : (dataContext: any) => any };

    /**
     * Called by the browser when an instance of this element/component is created.
     */
    public createdCallback() {
        super.createdCallback();
        this.itemNodes = new Array<Array<Node>>();
        this.itemNodeBindings = new Array<Array<NodeDataBindingInformation>>();
        this.itemEventCallbacks = { };
    }

    /**
     * Override processing of event bindings - we take care of this ourselves.
     */
    protected processEventBindings(node: Node): void {
        return;
    }

    /**
     * Meant to be called if the data context is ever changed, requiring a refresh of the list.
     * TODO: Release data bindings
     */
    public dataContextUpdated() {
        for (var i = 0; i < this.itemNodes.length; i++) {
            for (var j = 0; j < this.itemNodes[i].length; j++) {
                this.itemNodes[i][j].parentNode.removeChild(this.itemNodes[i][j]);
            }
        }
        this.itemNodes.splice(0, this.itemNodes.length);
        this.itemNodeBindings.splice(0, this.itemNodeBindings.length);
        this.populateAllItems();
        (<ObservableArray<any>>this.dataContext.value).itemAdded.subscribe((arg) => this.itemAdded(arg));
        (<ObservableArray<any>>this.dataContext.value).itemRemoved.subscribe((arg) => this.itemRemoved(arg));
    }

    /**
     * Called when an item has been added to the backing observable array.
     * @param {ObservableArrayEventArgs} arg Arguments detailing what was added and where
     */
    public itemAdded(arg: ObservableArrayEventArgs<any>): void {
        // Throw the item into an observable for data context and bindings
        var itemDataContext = new Observable<any>(arg.item);

        // Clone the item template, apply data context to any components
        var clone = document.importNode(this.template.content, true);
        var cloneNodes = new Array<Node>();
        for (var j = 0; j < clone.childNodes.length; j++) {
            cloneNodes.push(clone.childNodes[j]);
            this.applyMyDataContext(clone.childNodes[j], itemDataContext);
            this.setParentComponent(clone.childNodes[j], this.parentComponent);
            this.applyRepeaterEvents(clone.childNodes[j], itemDataContext);
        }

        // Capture the reference node before we shift the reference array
        var refNode = null;
        if (this.itemNodes.length === 0) { // First item
            refNode = this.nextSibling;
        } else if (arg.position < this.itemNodes.length) { // Middle item
            refNode = this.itemNodes[arg.position][0];
        } else { // Last item
            var refNodes = this.itemNodes[this.itemNodes.length - 1];
            refNode = <HTMLElement> refNodes[refNodes.length - 1].nextSibling;
        }

        this.itemNodes.splice(arg.position, 0, cloneNodes);

        // Append to the DOM in the proper place
        this.parentNode.insertBefore(clone, refNode);

        // Process text bindings
        var itemBindings = new Array<NodeDataBindingInformation>();
        for (var j = 0; j < cloneNodes.length; j++) {
            var nodeBindings = this.dataBinder.processBindings(cloneNodes[j], itemDataContext);
            for (var k = 0; k < nodeBindings.length; k++) {
                itemBindings.push(nodeBindings[k]);
            }
        }

        // Append to the array in the proper place
        this.itemNodeBindings.splice(arg.position, 0, itemBindings);

        // Resolve text bindings
        this.dataBinder.resolveBindings(itemBindings);
    }

    /**
     * Called when an item has been removed from the backing observable array.
     * @param {ObservableArrayEventArgs} arg Arguments detailing what was removed and where
     */
    public itemRemoved(arg: ObservableArrayEventArgs<any>): void {
        // Release all the associated data bindings
        var itemBindings = this.itemNodeBindings[arg.position];
        this.dataBinder.releaseBindings(itemBindings);
        this.itemNodeBindings.splice(arg.position, 1);

        // Remove nodes from the DOM
        var nodesToBeRemoved = this.itemNodes[arg.position];
        for (var i = 0; i < nodesToBeRemoved.length; i++) {
            nodesToBeRemoved[i].parentNode.removeChild(nodesToBeRemoved[i]);
        }
        this.itemNodes.splice(arg.position, 1);
    }

    /**
     * Called by the browser when this instance is added to the DOM.
     * This is where any 'constructor' processing needs to happen.
     */
    public attachedCallback() {
        super.attachedCallback();
        this.template = this.querySelector("template");
        if (this.template == null) {
            throw new Error("Template undefined for repeater component."
                + " A repeater element should always contain a template element.");
        }

        if (!(this.dataContext.value instanceof ObservableArray)) {
            throw new Error("Invalid data context for repeater component."
                + " A repeater element should have an observable array set as the data context.");
        }

        // Check if we have any events to bind
        for (var i = 0; i < this.attributes.length; i++) {
            var attributeName = this.attributes[i].name;
            var attributeValue = this.attributes[i].value;
            if (attributeName.indexOf("data-event-item-") === 0) {
                var eventName = attributeName.replace("data-event-item-", "");
                if (this.parentComponent && this.parentComponent[attributeValue]) {
                    this.itemEventCallbacks[eventName] = this.parentComponent[attributeValue];
                } else {
                    console.error(this.tagName + " attempted to bind event to unexisting callback '"
                        + attributeValue + "' on "
                        + this.parentComponent.tagName);
                }
            }
        }

        this.dataContext.onValueChanged.subscribe(() => {
            this.dataContextUpdated();
        });
        this.dataContextUpdated();
    }

    /**
     * Reads every item from the observable array, processes data binding for it,
     * and adds it to the DOM. Assumes all processed list info / DOM is clean.
     */
    private populateAllItems(): void {
        var array = <ObservableArray<any>>this.dataContext.value;
        var refNode = this.nextSibling;
        for (var i = 0; i < array.size; i++) {
            var itemDataContext = new Observable<any>(array.get(i));
            var clone = document.importNode(this.template.content, true);
            var cloneNodes = new Array<Node>();
            for (var j = 0; j < clone.childNodes.length; j++) {
                cloneNodes.push(clone.childNodes[j]);
                this.applyMyDataContext(clone.childNodes[j], itemDataContext);
                this.setParentComponent(clone.childNodes[j], this.parentComponent);
                this.applyRepeaterEvents(clone.childNodes[j], itemDataContext);
            }
            this.itemNodes.push(cloneNodes);
            this.parentNode.insertBefore(clone, refNode);
            refNode = cloneNodes[cloneNodes.length - 1].nextSibling;
            var itemBindings = new Array<NodeDataBindingInformation>();
            for (var j = 0; j < cloneNodes.length; j++) {
                var nodeBindings = this.dataBinder.processBindings(cloneNodes[j], itemDataContext);
                for (var k = 0; k < nodeBindings.length; k++) {
                    itemBindings.push(nodeBindings[k]);
                }
            }
            this.itemNodeBindings.push(itemBindings);
        }
        this.dataBinder.resolveAllBindings();
    }

    /**
     * Applies set of events to particular node
     * @param {Node} node to apply events to
     * @param {any} dataContext Data context for this event
     */
    private applyRepeaterEvents(node: Node, dataContext: any) {
        for (var eventName in this.itemEventCallbacks) {
            if (this.itemEventCallbacks[eventName]) {
                node.addEventListener(eventName, (args) => this.itemEventCallbacks[eventName](dataContext));
            }
        }
    }
}

Component.register("ui-repeater", Repeater);
