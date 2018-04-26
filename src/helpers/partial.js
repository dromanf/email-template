import handlebars from 'handlebars';

module.exports = function(name, options) {
    handlebars.registerPartial(name, options.fn);
}